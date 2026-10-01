# API boundaries

There are **three** interfaces in this system, and confusing them is the fastest way
to misdiagnose an outage.

| Boundary | Caller | Callee | Credential |
|---|---|---|---|
| Data | Browser | Supabase PostgREST / Auth | The user's Supabase JWT, under RLS |
| Generation | Browser | FastAPI (`NEXT_PUBLIC_API_URL`) | The user's Supabase JWT, `Authorization: Bearer` |
| Worker | Next.js `/api/jobs/drain` | FastAPI | `WORKER_SHARED_SECRET` + `X-PromptMaster-User` |
| Worker | Next.js `/api/jobs/drain` | Supabase | `SUPABASE_SERVICE_ROLE_KEY`, via SECURITY DEFINER functions |

**The save path never touches FastAPI.** Project edits go browser → Supabase directly.
If saving is broken, the backend is not the place to look.

---

## 1. Data boundary — browser to Supabase

Every table has its own module under `frontend/src/lib/supabase/`. There is no ORM and
no generic query builder in application code; a table gets a module, and the module is
the only thing that knows its column list.

Isolation is enforced by row-level security keyed on `auth.uid()`, plus composite
`(project_id, user_id)` foreign keys so a child row cannot be parented into another
user's project even by a service-role client. See [`data-model.md`](data-model.md).

## 2. Generation boundary — browser to FastAPI

Base URL: `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

All calls go through `apiFetch` in `frontend/src/lib/api/client.ts`, which:

- attaches `Authorization: Bearer <access_token>` from the cached Supabase session;
- retries **once** on a 401 after refreshing the session;
- unwraps FastAPI's `detail` into an `ApiError` carrying `status`, `code`, `title`,
  `retryable`, `retryAfter`, `providerStatus`, and a separate `technical` string. The
  `message` is the plain-language recovery sentence; `technical` is what the "view
  technical details" disclosure shows and is deliberately never rendered by default.

### Authentication

Applied at router-include time in `backend/main.py`:

```python
_protected = [Depends(require_user)]
app.include_router(engine_router, dependencies=_protected)
```

so a new route cannot ship unprotected by omission. `backend/tests/test_auth.py`
asserts the property; `backend/tests/test_auth_worker.py` covers the worker
credential.

### CORS

`ALLOWED_ORIGINS` is a comma-separated list with **no hardcoded default**. If it is
unset, the split produces `['']`, no origin matches, and CORS fails closed. That is
deliberate — but it means an unset variable presents as "the app works when curled and
fails from the browser". See [`runbook.md`](runbook.md).

### Endpoint inventory

Public — no credential required:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness. Returns `{"status": "ok"}`. |
| GET | `/api/modes` | Static mode data from `promptmaster/modes.py`; the marketing page reads it. |

Authenticated. Status was determined by finding the call sites of each `api.*` method
in `frontend/src/` (last done 2026-10-01, on the branch that added this sentence), not
from memory. **Live** = something calls it. **Dormant** = the endpoint exists and is
authenticated, but nothing calls it.

Stage work:

| Method | Path | `api` method | Router | Status |
|---|---|---|---|---|
| POST | `/api/generate-stage-artifact` | `generateStageArtifact` | `stage.py` | **Live** — **one** LLM call, deliberately not the full pipeline. The request carries the item schema's statuses and which of them the model may set; anything else it returns is dropped |
| POST | `/api/evaluate-stage-artifact` | `evaluateStageArtifact` | `stage.py` | **Live** |
| POST | `/api/extract-figures` | `extractFigures` | `stage.py` | **Live** — called once when a stage is completed. Returns `{figures: [{name, value, context}]}`; a value is kept only if the stage's text contains it verbatim (`promptmaster/figures.py`) |
| POST | `/api/apply-recommendations` | `applyRecommendations` | `audit.py` | **Live** — FR-09, one call for a multi-select apply |
| POST | `/api/check-conflicts` | `checkConflicts` | `conflicts.py` | **Live** — one JSON call per instruction (side chat, reply action buttons, Go's revisions); returns only conflicts with things actually listed |
| POST | `/api/flow-trigger` | `flowTrigger` | `engine.py` | **Live** — Refine, Realign, Challenge, Reframe, Self-audit from the stage's More menu |
| POST | `/api/continue-document` | `continueDocument` | `continuation.py` | **Live** — "Continue writing" on a draft that was cut off |
| POST | `/api/export-session` | `exportSession` | `engine.py` | **Live** |

Side chat:

| Method | Path | `api` method | Router | Status |
|---|---|---|---|---|
| POST | `/api/chat-message` | `chatMessage` | `conversation.py` | **Live** |
| POST | `/api/suggest-actions` | `suggestActions` | `conversation.py` | **Live** — given a chat reply and the stage, returns at most four actions `{label, kind: revise \| row_updates \| add_rows, …}`; "Do nothing" is added by the client. Prompt in `promptmaster/reply_actions.py` |
| POST | `/api/apply-to-answer` | `applyToAnswer` | `conversation.py` | **Live** |
| POST | `/api/save-as-new-version` | `saveAsNewVersion` | `conversation.py` | **Live** |

Outline and long-form:

| Method | Path | `api` method | Router | Status |
|---|---|---|---|---|
| POST | `/api/generate-outline` | `generateOutline` | `long_form.py` | **Live** |
| POST | `/api/generate-section-prose` | *(not in `client.ts`)* | `long_form.py` | **Live — worker only**, via `lib/jobs/generator.ts` |
| POST | `/api/extract-section-record` | *(not in `client.ts`)* | `long_form.py` | **Live — worker only**, via `lib/jobs/generator.ts` |
| POST | `/api/estimate-job` | `estimateJob` | `usage.py` | **Live** — the cost estimate shown before a large drafting run |

Project setup:

| Method | Path | `api` method | Router | Status |
|---|---|---|---|---|
| POST | `/api/generate-setup` | `generateSetup` | `setup.py` | **Live** |
| POST | `/api/guide-next-question` | `guideNextQuestion` | `setup.py` | **Live** — "Guide me": takes the objective and the questions answered so far, returns `{enough, question, reason}` — one question at a time, or `enough: true` |
| GET | `/api/models` | `getModels` | `meta.py` | **Live** — carries its own `Depends(require_user)` inside the otherwise-public meta router, because it proxies OpenRouter and is billable |

Go mode (the loop itself runs in the browser; see [`architecture.md`](architecture.md) § Go mode):

| Method | Path | `api` method | Router | Status |
|---|---|---|---|---|
| POST | `/api/agent/next-action` | `agentNextAction` | `agent.py` | **Live** — chooses ONE move from `allowed_actions`; anything else becomes `request_user_decision` |
| POST | `/api/agent/reason` | `agentReason` | `agent.py` | **Live** — performs a reasoning move (label `discussed`); 422 for non-reasoning actions |
| POST | `/api/agent/write-code` | `agentWriteCode` | `agent.py` | **Live** — code only, never claimed output (label `code_written`). Told the project's data files by name, columns and first rows |
| POST | `/api/agent/interpret-result` | `agentInterpretResult` | `agent.py` | **Live** — takes the real stdout/stderr/exit code from a `sandbox_runs` row (label `result_interpreted`) |
| POST | `/api/agent/triage` | `agentTriage` | `agent.py` | **Live** — decides a review table's routine findings |
| POST | `/api/agent/literature` | `agentLiterature` | `agent.py` | **Live** — no model. Takes up to 20 `{id, work}`; searches OpenAlex by title and returns `{matches: [{id, found, title, authors, year, doi, url, note}]}`. A match needs 80% of the title's words and a year within one (`promptmaster/literature.py`). Used by "Look up these works" (Literature), "Look up these sources" (Fact-check) and Go's `check_literature` |
| GET | `/api/agent/actions` | *(none)* | `agent.py` | Dormant — the registry is mirrored in TypeScript and `actions-drift.test.ts` keeps the two equal |

Dormant — the retired `/session` flow's server side, kept on purpose:

| Method | Path | `api` method | Router |
|---|---|---|---|
| GET | `/api/modes` | `getModes` | `meta.py` — **public** |
| POST | `/api/guide-questions` | `guideQuestions` | `setup.py` — the batch form `guide-next-question` replaced |
| POST | `/api/generate-section` | `generateSection` | `long_form.py` — superseded by the two worker calls |
| POST | `/api/finalize-long-form` | `finalizeLongForm` | `long_form.py` |
| POST | `/api/detect-long-form` | `detectLongForm` | `long_form.py` |
| POST | `/api/build-prompt` | `buildPrompt` | `engine.py` |
| POST | `/api/run-iteration` | `runIteration` | `engine.py` |
| POST | `/api/flow-inspect` | `flowInspect` | `engine.py` |
| POST | `/api/build-realignment` | `buildRealignment` | `engine.py` |
| POST | `/api/run-self-audit` | `runSelfAudit` | `engine.py` |
| POST | `/api/hard-reset-lessons` | `hardResetLessons` | `engine.py` |
| POST | `/api/format-summary` | `formatSummary` | `engine.py` |
| POST | `/api/audit-findings` | `auditFindings` | `audit.py` |
| POST | `/api/apply-audit` | `applyAudit` | `audit.py` |

Twenty-five of the forty endpoints above are live. The rest are a consequence of retiring
`/session` without deleting its server side, which was the right call — but it means
the API surface is larger than the product.

Dormant endpoints are still authenticated and still billable against the OpenRouter
key. They are not a security hole — a caller must be a signed-in user — but they are
cost surface. See [`known-limitations.md`](known-limitations.md).

`GET /api/modes` is public and has no caller.

### Request/response contract

Schemas are Pydantic models in `backend/promptmaster/schemas.py`. The frontend mirrors
them in `frontend/src/types/index.ts`. **These are two hand-maintained copies of one
contract** — there is no codegen. Changing a schema means changing both.

`llm_client.generate_json()` requests JSON mode, strips code fences, and on a parse
failure makes a **second repair call** before giving up. Assume JSON responses reaching
your code are validated, not raw.

## 3. Worker boundary

`POST` (and `GET`) `/api/jobs/drain` on the Next.js deployment. Full description in
[`jobs.md`](jobs.md). The frontend project has two other server routes, each there for
the same reason — it writes or reads with the service role, which the backend never
holds: `POST /api/sandbox/run` (runs model-written code in a Vercel Sandbox with the
project's data files at `/data`, and writes the `sandbox_runs` row that makes an
execution label honest; the user's JWT, with the project, run and step re-checked
against it) and `GET /api/admin/overview` (FR-18/FR-19; `ADMIN_USER_IDS`).

Authorisation accepts either credential:

- `Authorization: Bearer <CRON_SECRET>` — compared in constant time. An unset or empty
  `CRON_SECRET` cannot match, so the cron path simply stops working rather than opening
  up.
- `Authorization: Bearer <user JWT>` — verified with `auth.getUser()`. This path
  **requires `project_id` in the JSON body** (400 without it) and re-checks ownership
  with the service client, returning **404** rather than 403 when the project is not
  the caller's. That is intentional: a 403 would confirm the project exists.

Onward to FastAPI it sends `Authorization: Bearer <WORKER_SHARED_SECRET>` plus
`X-PromptMaster-User: <user_id>`. The backend accepts the shared secret only when the
user header is present — a worker credential with no user attached is rejected.

**`WORKER_SHARED_SECRET` must be identical in both Vercel projects.** A mismatch
presents as every drafting job failing with a 401 from the backend while the UI and
saving work perfectly.
