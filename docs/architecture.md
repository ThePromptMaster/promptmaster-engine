# Architecture

Audience: someone taking over operation of PromptMaster, who has not worked on it.

For a working-in-the-repo orientation (conventions, where prompt strings go, which
module cites which book chapter) see [`../CLAUDE.md`](../CLAUDE.md). This document
does not repeat it.

---

## The shape of the system

Three deployed things and one browser:

```
  Browser ──────────────────────────────────► Supabase
     │        all persistence, direct,          (Postgres + Auth + RLS)
     │        under row-level security               ▲
     │                                               │ service-role key
     ├──────► Next.js (Vercel project 1)             │
     │          • the entire UI                      │
     │          • /api/jobs/drain — the only         │
     │            server route; the job worker ──────┘
     │                    │
     │                    │ WORKER_SHARED_SECRET
     │                    ▼
     └──────► FastAPI (Vercel project 2)  ──────────► OpenRouter
                • stateless LLM proxy                  (the models)
                • owns no user data
```

The two Vercel projects deploy **independently** from the same repository (`frontend/`
and `backend/`). They do not share a build, a release, or a version number. A change
that alters the contract between them has to be shipped in a compatible order — the
backend first, since the frontend is the caller.

## The load-bearing invariant

**The backend is a stateless but authenticated LLM proxy that owns no user data.**

`backend/` has no Supabase data client, no persistence, no session store, and no
cache of user state. Every request carries the state it needs — inputs, iteration
history, chat history, the stage's artifact. All persistence happens in the frontend
via the Supabase JS SDK, under row-level security, as the signed-in user.

Two consequences worth internalising before changing anything:

- **User isolation is enforced by Postgres, not by application code.** RLS policies
  and the composite ownership foreign keys (see [`data-model.md`](data-model.md)) are
  what stop one user reading another's project. There is no ownership check in the
  backend to audit, because the backend never reads user rows.
- **The backend can be redeployed, restarted, or scaled to zero without data loss.**
  It holds nothing. The only in-process state is one shared `OpenRouterClient` created
  per app lifespan (`backend/deps.py`), injected via `get_client()`.

Do not add a Supabase data client or a session store to the backend. Doing so moves
user isolation out of the database and into code, and quietly makes the above false.

### The one exception, and why it is not one

The job worker (`frontend/src/app/api/jobs/drain/route.ts`) *does* hold
`SUPABASE_SERVICE_ROLE_KEY` and *does* write user rows. It is a Next.js route handler,
not the FastAPI backend, and it never bypasses ownership: every write it makes goes
through a `SECURITY DEFINER` function that re-checks ownership itself, and the jobs it
processes were enqueued by `enqueue_job`, which verifies `projects.user_id = auth.uid()`
before inserting. See [`jobs.md`](jobs.md).

The worker calls FastAPI for generation, authenticating with `WORKER_SHARED_SECRET`
and passing the owning user in an `X-PromptMaster-User` header — so even a worker-driven
generation is attributed to a user on the backend side.

## Authentication

Supabase Auth issues the JWT. Three consumers verify it, in three different ways, and
it is worth knowing which is which when a 401 shows up.

| Consumer | What it checks | Where |
|---|---|---|
| Next.js route protection | `supabase.auth.getUser()` in the proxy; redirects `/projects/*` to `/auth/login` when signed out, and `/auth/*` to `/projects` when signed in | `frontend/src/proxy.ts` |
| Supabase (data) | The JWT itself, via RLS policies keyed on `auth.uid()` | migrations |
| FastAPI | Signature verification of the bearer token | `backend/auth.py` |

This is **Next.js 16**: route protection lives in `src/proxy.ts`, not `middleware.ts`.
Its `config.matcher` is `['/projects/:path*', '/auth/:path*']` — nothing else is gated
there, and the proxy is a redirect layer, not a security boundary. The security
boundary is RLS.

`backend/auth.py` handles both Supabase signing schemes: an HS256 token is verified
against `SUPABASE_JWT_SECRET`; an asymmetric token (ES256/RS256, which newer Supabase
projects issue) is verified against the project's rotating JWKS at
`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Both env vars are therefore worth
setting even though only one path will normally be taken — see
[`deployment.md`](deployment.md).

`AUTH_ENFORCED` exists as a rollout lever: setting it to `false` lets an unauthenticated
request through, logging `UNAUTHENTICATED_REQUEST`. It defaults to **true**. It should be
`true` in production and there is no reason to change that outside a deploy-ordering
emergency.

## The API boundary

Auth is applied at **router-include time**, not per endpoint:

```python
_protected = [Depends(require_user)]
app.include_router(engine_router, dependencies=_protected)
```

`backend/main.py` does this for every router, so a newly added route cannot ship
unprotected by omission. `backend/tests/test_auth.py` asserts the property holds.
Public surface is exactly two routes: `GET /api/health` and `GET /api/modes` (static
mode data the marketing page reads). `GET /api/models` is inside the otherwise-public
meta router but carries its own `Depends(require_user)`, because it proxies OpenRouter
and is therefore billable.

The full endpoint inventory is in [`api.md`](api.md).

## Frontend structure

- `src/app/` — App Router. `projects/`, `projects/[id]`, `projects/new`, `auth/*`,
  plus `api/jobs/drain` (the only server route), and `session/` which is a bare
  redirect to `/projects`.
- `src/lib/workflow/` — the workflow engine. `engine.ts` is **pure functions**:
  evaluate a stage's exit criteria, project state from the event log, list available
  transitions. `templates/*.v1.ts` are the authoring source for the `book`, `research`
  and `single_output` workflows.
- `src/components/workflow/` — the workspace, stage rail, header, exit-criteria
  checklist, transition bar, and `renderers/`.
- `src/lib/supabase/` — one module per table. This is the whole persistence layer.
- `src/lib/api/client.ts` — the `api` object. Every backend call goes through
  `apiFetch`, which attaches `Authorization: Bearer <token>` from the *cached* session
  (`getSession()`, not `getUser()` — the latter would be a network round-trip on every
  one of ~20 methods), retries once on a 401 after refreshing, and unwraps FastAPI's
  `detail` into a typed `ApiError` carrying status, error code, retryability and a
  separate `technical` string. **The frontend never talks to an LLM directly.**
- `src/stores/project-store.ts` — the project cache and the save pipeline. See
  [`saving-and-concurrency.md`](saving-and-concurrency.md).

### Two ideas that carry most of the design

**Stage state is projected from an event log, in exactly one place.** `projectState`
in `src/lib/workflow/engine.ts` folds `workflow_events` into the current stage,
completed stages, skipped stages and their reasons. `projects.stage` is a
*denormalised cursor* for the project list view, not the truth. If the two ever
disagree, the events win.

**Exit criteria are declarative predicates evaluated by pure functions — never an LLM
call.** A gate that fails because a model timed out is a gate users learn to resent.
An unknown rule type degrades to a manual checklist item rather than throwing, so a
template authored against a newer engine still renders on an older one.

### Renderers

`stage.renderer` is dispatched by `components/workflow/renderers/stage-renderer.tsx`.
Four renderers — `prose`, `list`, `review`, `long_form` — cover 33 stages across the
three workflows (book 15, research 13, single_output 5), plus the outline stage, which
is served by `OutlineStagePanel` mounted directly by the workspace rather than through
the renderer switch. (`CLAUDE.md` said "five renderers cover 26 stages across both
workflows"; that was true when written, before `single_output` and the later template
versions. Corrected there in the same change that added these documents.)

**No renderer branches on which workflow it is**, and a test in
`renderers.test.tsx` asserts that. Book's fact-check table and Research's
reproduction table are the same `review` renderer with different columns. This is the
property that makes a fourth workflow cheap.

## Extension points

These are the seams the system was built to be extended at. Working with them is
routine; working around them is how the next person inherits a mess.

### Adding or revising a workflow

Author it in TypeScript at `frontend/src/lib/workflow/templates/<name>.v<n>.ts`, then
regenerate the seed migration:

```
cd frontend
npm run --silent gen:templates > ../supabase/migrations/<timestamp>_seed_workflow_templates.sql
```

**The `--silent` matters** — without it npm's banner lands in the SQL file and the
migration will not parse. `seed-drift.test.ts` fails if the TypeScript and the
migration disagree, so this cannot silently rot.

Published templates are **immutable**. Revising one publishes a *new version*; a book
halfway through drafting keeps the version it pinned in
`projects.workflow_template_id` and is unaffected. Never edit a published row in place.

### Adding a stage renderer

Add the component under `components/workflow/renderers/`, add a `case` to
`StageRenderer`, and use the new value in a template. The switch has a
`NotYetRenderer` default that names the missing renderer rather than falling through
to prose — so a template can reference a renderer before it exists without looking
like a bug.

### Adding a backend endpoint

Add it to an existing router in `backend/routers/` (thin HTTP shells) with the prompt
text in `backend/promptmaster/` — never in a router. A new router must be included in
`main.py` with `dependencies=_protected`. Add a router test that asserts on **prompt
content**, not on LLM output; tests never call OpenRouter.

If the endpoint creates an `Iteration`, use
`routers/_pipeline.build_iteration_with_full_pipeline()`. It is *the* iteration path:
it fans out evaluation, suggestions and summary in parallel, stamps the provenance
fields, and force-sets `completeness = incomplete` when the model hit its token limit.
Never re-implement that fan-out.

### Adding a job kind

See [`jobs.md`](jobs.md). Today exactly one kind exists (`draft_section`) and
`runJob` fails an unknown kind non-retryably, so a new kind is a handler plus a case.

### Adding a table

See [`data-model.md`](data-model.md) — in particular the four invariants the schema
enforces. A new child table of `projects` should carry the composite
`(project_id, user_id)` foreign key, not a plain `project_id`.

## What exists server-side but is not reachable in the UI

The `/session` flow was retired on 2026-09-07. Its backend endpoints all still exist
and are still authenticated — nothing was deleted server-side. The chat panel, flow
triggers, flow inspections, audit findings, continue-document, generated realignment
prompts, self-audit, prompt-stack templates, custom personas, preset pills and
`.txt`/`.json` session export are a **UI job, not a rebuild**, if they are ever wanted
back. `api.md` marks which endpoints these are.

The evaluation pipeline is likewise intact. Stage generation deliberately does not
call it: `/api/generate-stage-artifact` is one LLM call, because the full pipeline
scores output against `inputs.objective`, which judges a list of audience segments
against the wrong thing and costs four calls where one will do.
