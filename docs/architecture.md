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

**One project snapshot, one place to refresh.** The project store
(`src/stores/project-store.ts`) loads the project, every stage's artifact and versions,
the `workflow_events` log, and the recommendations and tasks together, and every write
goes back through it: `appendEvent` inserts and then *re-reads* the log, so the record
the workspace, the rail, Go mode and the recommendations panel project from is always
what the database holds — including rows the server wrote in the meantime. Until
2026-09-28 the workspace kept its own copy of the events with seven ad-hoc reloads and
the recommendations hook loaded once per project, and the surfaces could disagree
about what had happened. The exit-criteria context is likewise built once for every
stage (`src/lib/workflow/context.ts`), keyed by stage id, so the stage Go evaluates and
the stage the user is viewing read the same facts.

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

## Phase C surface (2026-09-29)

Four things a reader of the workspace should know. The exit-criteria checklist has two
groups, *PromptMaster checked* and *You decide*; a criterion authored as a check that the
engine cannot compute on that stage carries `degraded: true` and lands in the second group
with a note. A done stage can be **reopened** (`stage_reopened`, user only, cursor unmoved)
and closed again with the ordinary `stage_marked_complete`; when the second completion cites
different evidence than the first, `projectState` marks the done stages after it `stale`,
from the events alone. The same holds for a stage that was **left open**: `stage_advanced`
records the version it was left with (`payload.left_version_id`, since 2026-10-01), and
closing it later on a different version marks the done stages after it `stale`; closing it
by ticking a box on the same version flags nothing. The rail draws an open stage that is
not the current one with its own glyph and a "left open" or "reopened" tag, and the stage
header names it. What the finished thing and its parts are called comes from the template
(`nouns`, or `deliverableNouns` in `lib/workflow/labels.ts` for versions published before
it existed). A finished project leads with `components/workflow/project-finished.tsx`
(read, copy, Markdown, Word via `lib/export/docx-export.ts`, PDF via the print route).
Version pills show the current version, the ones `isSaved` (`lib/workflow/labels.ts`) says
the user chose to keep, and the rest behind "Full history". The claim table's statuses are
provenance first (`candidate_source`, `no_source`, both undecided) and decisions second.

**Side-chat actions (2026-10-01).** An Ask reply is offered as at most four actions from
`POST /api/suggest-actions`, not one Apply per bullet (the list parser in
`critique-points.ts` still serves Challenge / Reframe / Self-audit, where each point is a
finding). On a prose stage an action is a revision instruction and goes through the
ordinary apply-findings preview. On a table stage it is row changes: `previewRowAction`
(`lib/workflow/row-actions.ts`, pure) works out the rows as they would be and a plain list
of what changes, the user reviews it in the chat panel, and saving appends a version with
`source_operation: 'chat_rows'`. Both the server and the client drop rows, statuses and
fields the table does not have. Actions are requested only for replies given while the
panel is open; an older reply gets a "Suggest actions" button.

## Go mode (Phase B: PM-12, PM-15, PM-17 … PM-20)

The next-best-action loop runs **in the browser** (`components/workflow/use-go-loop.ts`)
and persists every step as it goes. The backend stays stateless: it chooses a move and
performs model work (`/api/agent/*`, B2); the Next route `/api/sandbox/run` executes code in
a Vercel Sandbox and writes the only trusted record of it (B3); the database decides what a
run may do on its own (B1).

| Layer (PM-15) | Question | Where |
|---|---|---|
| Workflow | where are we | the stage (`projectState`) |
| Mode | how to think | `projects.mode`, the stage header picker |
| Action | what now | `lib/agent/actions.ts` ↔ `backend/promptmaster/agent_actions.py` (drift-tested) |
| Execution policy | how autonomously | Guided / Checkpoint / Autonomous (`lib/agent/policy.ts`) |

One pass of the loop: `preempt` (budget, blocked, finished, no progress, repeated failure —
no model call) → `next-action` (a move from `allowedActions` only) → **insert the step** →
pause for approval if the policy says so → `performStep` → close the step with a label
derived from what happened (`lib/agent/labels.ts`). `run_computation` is followed by an
automatic `interpret_result` step that cites the sandbox run.

**One read per pass (2026-10-01).** `readStageFacts` (`lib/agent/facts.ts`) reads the
outline, the manuscript and the event log from the database, and that one read decides
the allowed moves, the requirements (`contextWithFacts` → `evaluateStage`), whether the
next move is the user's, and what the planner is shown (`buildAgentState` takes `facts`).
Before this the planner's excerpt and the requirements came from the store's bundles,
which lag the section jobs, so Go could call a written Drafting stage empty.

**A stop is re-checked (2026-10-01).** When a run stops for the user it records what it
needs (`agent_runs.needs`, with `onStage`). `useGoLoop` re-reads the stage whenever the
project changes and asks `needStillHolds` (`lib/agent/needs.ts`, pure); a request the user
has satisfied on the stage itself, or one raised on a stage the project has left, is
cleared and Resume is offered. A used-up window is continued by the main button when the
policy and window size are unchanged; any new run started over a stopped one keeps that
run's steps as planner history.

**The window.** `budget_steps` counts performed actions (a computation counts two;
planning, waiting and the user's answers count none). It is not a cost limit. The
selector is restored from the run on load, and the progress count always shows the run's
own numbers.

**Overrides are the user's.** Moving past a stage with something required open needs a
reason (the transition bar's "Override and continue"; recorded on `stage_advanced.reason`
and shown on the rail). An Autonomous run is not offered `advance_stage` in that state
(`withoutOverride`, `lib/agent/policy.ts`); under Guided and Checkpoint the user's Approve
on the proposed move is the override.

**What a run remembers.** Nothing is stored as "memory". On every move the planner is
given `projectMemory()` (`lib/agent/memory.ts`, pure): the user's skips, overrides,
reopenings, priority decisions, accepted and dismissed suggestions and answers to Go's
questions, rebuilt from `workflow_events`, `recommendations` and the steps of this window
and the ones it continues (`listChainSteps`, reloaded on adopt). An Autonomous
authorization can carry `auto_continue_windows`; the loop then starts the next window
itself when one is used up, through the same `continueRun` a click uses, marking the new
run `auto_continued`; `agent_runs_guard` counts those against the authorization
(20261010000000), so the allowance is the database's to keep, not the loop's.

**The order is a default.** On a stage the template allows to be skipped, the planner may
choose `propose_skip`: a suggestion with a reason, never a skip. The run stops with a
`skip_stage` need; the card's button performs the ordinary skip transition as the user
(`stage_skipped`, `actor='user'`, Go's reason as the recorded one) and Resume does the
stage instead. It is offered once per stage per run. A skipped stage can be reopened like
a done one.

**What the planner may say.** Its `rationale`, `expected_outcome` and `decision_question`
are shown to the user, so the prompt (`promptmaster/agent.py`) names its own sections in
plain words ("MOVES AVAILABLE NOW", "WHAT THIS STAGE HOLDS NOW") and forbids "artifact",
"action set", "model call" and action keys in what it writes. A test pins this.

**"Succeeded" is read back.** After a step that claims a change, `readOutcomeProof`
re-reads the project and `verifyOutcome` (`lib/agent/outcome.ts`, pure) fails the step if
the saved version, the written sections, the evaluation or the stage move is not there.

Honesty is enforced twice: `deriveExecutionLabel` never takes a label from the model, and
`agent_steps_label_honest` refuses `code_executed`/`simulation_run` without a sandbox run
for the step and `result_interpreted` without one to cite. Stage moves are the user's when
they approved them; only an Autonomous run records them as `actor='system'`, citing the run,
which `workflow_events_agent_authorized` checks against its accepted authorization.

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
