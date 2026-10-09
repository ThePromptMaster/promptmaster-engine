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

**A chapter takes the mode as a voice, not as a scaffold (2026-10-03).** Every stage
prompt goes through `_shared_system` (`backend/promptmaster/conversation.py`): the
PromptMaster context, then the mode's lock, tone and `[INTERNAL SCAFFOLDING]`. Architect
is the default mode, and its lock says "You do not write final prose — you build
scaffolding"; through `_shared_system` that reached every chapter prompt beside "Do NOT
outline", and the chapters came out as outlines (the client, 2 Oct). Section prose
(`build_section_prompt`, `build_section_revision_prompt`) now goes through
`_prose_system`: the context, the mode's name and tone (and a custom persona's preamble),
and a sentence saying the mode's structural habits do not apply. The long-form stage's
own `entry_prompt_hint` travels in each section job's payload as `stage_hint` and reaches
the chapter prompt; it never did before. Prose stages keep the full mode lock, with one
added sentence that the stage's instruction decides the form. The setup suggester is told
a book's output format is manuscript prose, and a Book created with no format gets one
(`BOOK_OUTPUT_FORMAT`).

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
`POST /api/suggest-actions`, not one Apply per bullet. Since 2026-10-02
Challenge / Reframe / Self-audit end the same way: their text goes through the same call
(`critique-follow-up.tsx`), and the per-point list from `critique-points.ts` sits behind a
closed "Review the points one by one" disclosure. The stage check's own findings are
unchanged (capped at 3 / 7 / 10 by intensity). On a prose stage an action is a revision instruction and goes through the
ordinary apply-findings preview. On a table stage it is row changes: `previewRowAction`
(`lib/workflow/row-actions.ts`, pure) works out the rows as they would be and a plain list
of what changes, the user reviews it in the chat panel, and saving appends a version with
`source_operation: 'chat_rows'`. Both the server and the client drop rows, statuses and
fields the table does not have. Actions are requested only for replies given while the
panel is open; an older reply gets a "Suggest actions" button.

**What the side chat is told (2026-10-03).** Every Ask, and "Save this discussion as a new
version", carries a `context` (`buildChatContext`, `lib/workflow/chat-context.ts`):
- the stage and its instruction
- the workflow's stages, in order
- the earlier stages' digest summaries
- the outline as "1. Title — abstract" lines
- the chapters (`formatManuscript`, bounded at 60k for chat)
- the page's buttons, from the same `stageControls` list Go is given

The backend renders this as the "WHERE THE USER IS" block (`promptmaster/page_context.py`),
with a rule never to ask the user to paste what the project holds. An outline stage is
read as titles and abstracts, and a chapter stage as its chapters. On both, the chat can
discuss but not splice: Change it and Save-as-version are off there, because the text it
sees is a rendering, not the stored version. Save-as-new-version now revises the current
text instead of rewriting from the thread alone.

**Button names in free text (2026-10-03).** `scrub_button_mentions` (`promptmaster/page_context.py`)
checks every "press / click / tap X" in Go's rationale, expected outcome and question, and in a
chat reply when the page's buttons were sent, against the page's buttons (plus Go's own
Resume / Stop / Go). It handles near misses differently from names that don't exist:
- A near miss ("Generate Outline" for "Generate the outline") is corrected to the page's words.
- Any other name is rewritten as plain words, followed by "(there is no button for this on this page)".

**Precedence (2026-10-03).** `promptmaster/precedence.py` defines one order for contradictions:
1. the objective
2. the user's decisions
3. the user's latest instruction
4. the stage's instruction
5. constraints and format
6. the mode
7. anything a model wrote earlier

The self-model states this order, so it reaches every prompt. A reply says which side it followed; the work itself just follows it. The self-model also says that a "write a book" objective is what the outline serves, not an order to write chapters on that stage.

The PM-24 conflict prompt still asks the user. It preselects the side the order favours (`recommendedControl`, `lib/workflow/precedence.ts`), and `precedence-drift.test.ts` keeps the two copies of the order equal.

**Workflows a user designs, and Exploration (2026-10-03).**

User-designed workflows: `POST /api/generate-workflow` plus `lib/workflow/custom.ts` build a
template, and `lib/workflow/validate.ts` checks it (every system template passes the same check).
The template is saved to `workflow_templates` as the user's own (`custom_` key, `wft_insert_own`).

Exploration loops: `transitions.loop_to` names where the next round starts. The stage bar
offers "Start the next round from X", and Go proposes it with `propose_next_round`; the user
always starts it. In a looping workflow:
- the digest carries the last round's stale stages, labelled "(last round)";
- Go treats a stage's draft as current only if it was written since the stage was last
  entered (`stageHasCurrentDraft`).

`template.inquiry` gives a workflow Go's reasoning moves. An Autonomous authorization may allow
up to 20 further windows.

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

**The manuscript on every stage after Drafting (2026-10-03).** The chapters live on the
first long-form stage's artifact, and the stages after it that are not themselves
long-form — Continuity, Critique, Fact-check, Final review — exist to read them. One pure
function says which stages those are (`manuscriptSourceFor`, `lib/workflow/context.ts`),
and both readers use it: the stage digest that generates a review (`buildStageDigest`,
bounded at 120k characters) and Go's planner state (`buildAgentState`, via the fresh
`facts.reads_manuscript`), which carries the counts, the word count and a 6,000-character
opening as `manuscript` with `own: false`. The backend prints it under "THE MANUSCRIPT
THIS STAGE REVIEWS" and tells the planner that an empty review table means "not drafted
yet — draft_stage drafts it from this text", never "missing data". Before this the planner
on a review stage saw an empty stage and "DATA THE PROJECT HOLDS: none", and marked
Fact-check, Critique and Continuity stuck for a draft that existed (the client's 2 Oct
screenshots). The stage's critique tools (Challenge, Reframe, Self-audit) read the same
text on a long-form stage, where there is no version to read until the stage completes.

**What the planner knows of the workflow, and when it may say "stuck" (2026-10-03).** The
state carries `workflow` — key, name, the stages in order with their renderers, and
`has_data_stages`, read off the templates (a stage whose item schema has `execution`). The
prompt prints the order as a WORKFLOW line, and the "DATA THE PROJECT HOLDS: none" line is
printed only for a workflow with such a stage; a Book is told it is a writing workflow and
never to ask for a dataset. Before this the planner asked "Write a book about lions" for
"the planned runs with their observed outcomes" (2 Oct, screenshot 8). `mark_blocked` is
offered only once the stage has been tried — not while `draft_stage` is on the menu — and
not while the stage can advance (`withoutOverride`), so Go cannot sit a "Stuck" card under
a "Nothing outstanding — move on" suggestion (screenshot 2). The user can still mark any
stage stuck by hand.

**A run going round in circles stops (2026-10-03).** Two guards, both pure and both before
any model call. `stateFingerprint` (`lib/agent/policy.ts`) reduces a fresh read to one
string — current stage, every stage's head version id, the event count, the blocking
criteria met, chapters written, rows decided, outline approved — and the loop records it
after each performed move; three in a row the same stops the run with "The last 3 moves
changed nothing on this stage … Tell me what to do differently, or do the next part
yourself and press Resume." `alternating` catches two moves taking turns on one stage for
three rounds (check, apply, check, apply, check, apply), which the same-move guard never
saw. The step timeline folds consecutive identical steps into one row with a count
(`collapseSteps`). The client's 2 Oct execution log was that loop: "Move to the next
stage", "Apply the findings", "Check this stage", repeated, then "Could not continue".

**A stop is re-checked (2026-10-01).** When a run stops for the user it records what it
needs (`agent_runs.needs`, with `onStage`). `useGoLoop` re-reads the stage whenever the
project changes and asks `needStillHolds` (`lib/agent/needs.ts`, pure); a request the user
has satisfied on the stage itself, or one raised on a stage the project has left, is
cleared and Resume is offered. A used-up window is continued by the main button when the
policy and window size are unchanged; any new run started over a stopped one keeps that
run's steps as planner history.

**A stuck stage (2026-10-02).** A `stage_blocked` event records what the stage had to
work with (`payload.inputs_at_block`: data file ids, the stage's head version, the brief —
`lib/workflow/stage-inputs.ts`). Go's card compares that with the project now. Changed:
it says what changed and leads with "Resume with what has changed". Unchanged: it says so
and leads, by kind of block, with "Add the missing data" (goes to the Data panel) or "Try
again". Then "Skip <stage> for now" where the stage allows it, and always "Continue this
stage by hand", which lifts the block and leaves Go stopped — **at most three buttons**
(2026-10-03; the client's 2 Oct screenshots showed five ways forward on one screen). The
footer names the stage bar's own transition button in its exact words, from the controls
registry. While Go's run holds the block, its card is the one surface: the stage's own
"Stuck" notice is not drawn beside it, and the "Move on — nothing outstanding" suggestion
is not derived for a stuck stage (`deriveWorkflowRecommendations`, `blocked`). A review
stage that has not been drafted is no longer "every finding triaged" (`engine.ts`). A block
recorded before this has no inputs, and the card claims neither. A retry that marks the
stage stuck again for the same kind of thing with nothing changed says so and is not
counted against the window. What "changed" does not see: an answer typed into Go's
question, or a tool that has since become available.

**The window.** `budget_steps` counts performed actions (a computation counts two;
planning, waiting and the user's answers count none). It is not a cost limit. The
selector is restored from the run on load and when a window is continued, and while a
window is live it shows that window's size; the progress count always shows the run's
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

**Which buttons the planner may name (2026-10-02).** The planner is sent the buttons that
are on the current stage's page (`state.controls`, built by `stageControls` in
`lib/workflow/stage-controls.ts` from the same primary action, More menu, transitions,
open approvals and panel labels the page draws). It may name a button only from that
list; a `params.control` that is not in it is dropped by `parse_next_action`, and one
that is in it is pointed to in fixed words by the performer. With no list (another stage
is on show) it is told to name none. The stage bar's transitions under More are built by
`transitionEntries` in the same file, and a browser test checks every listed label is on
the page. What this does not do: read the question's free text — a button named there in
other words is not caught.

**"Succeeded" is read back.** After a step that claims a change, `readOutcomeProof`
re-reads the project and `verifyOutcome` (`lib/agent/outcome.ts`, pure) fails the step if
the saved version, the written sections, the evaluation or the stage move is not there.

Honesty is enforced twice: `deriveExecutionLabel` never takes a label from the model, and
`agent_steps_label_honest` refuses `code_executed`/`simulation_run` without a sandbox run
for the step and `result_interpreted` without one to cite. Stage moves are the user's when
they approved them; only an Autonomous run records them as `actor='system'`, citing the run,
which `workflow_events_agent_authorized` checks against its accepted authorization.

Go's tools are few and each is called by the browser loop, never by a model: the code
sandbox (`/api/sandbox/run`), the project's data files it copies into `/data`, and
OpenAlex — a lookup of works the project names (`/api/agent/literature`) and a topic
search (`/api/agent/literature-search`), both without a model call. A search step is
labelled `discussed` ("Analyzed") with `tools_used: ['search']`: it read an index, ran no
code, and read no source. A tool the run does not have is not offered as a move
(`policy.ts`, `AgentTools`), so adding one is a performer plus a registry entry.

## Governance layer and autonomy (2026-10-04)

The client asked (3–4 Oct) whether the stages sit on top of an authoritative project
state that agents could execute against without owning — a "project graph" of
objective, constraints, decisions, evidence, artifacts, actions, approvals, unresolved
issues and next permissible actions. They do. This section is where each part lives, what
the database guarantees, and what is missing for the two directions discussed: outside
agents connected to PromptMaster, and agents running underneath it.

**The record.** Stage state is never stored as a status: it is projected from the
append-only `workflow_events` log in one place (`projectState`, `lib/workflow/engine.ts`).
The stage rail is a view of that projection.

| Part of the project | Where it lives |
|---|---|
| Objective, constraints, audience, format | `projects` |
| Decisions | `decisions` (append-only) |
| Proposals and approvals | `recommendations` (`pending → accepted / dismissed / superseded`, forward only) |
| Evidence | evidence-cited stage events, `sandbox_runs`, `artifacts.key_figures`, review rows |
| Artifacts and versions | `artifacts`, `artifact_versions` (append-only; restore appends) |
| Actions and results | `agent_runs`, `agent_steps` |
| Unresolved | `stage_blocked` events (with what the stage had), `project_tasks`, pending recommendations, `agent_runs.needs` |
| Next permissible actions | `availableTransitions` (engine) and Go's `allowedActions` / `shouldPause` (`lib/agent/policy.ts`) |

**What the database guarantees** (a client with the user's token cannot get round
these): `actor` is `user | system`, never a model; a stage move on a model's suggestion
needs an accepted recommendation and is then the user's; a `system` move needs a running
agent run under a recorded authorization, and each policy may record only certain moves;
skip, go back, finalize and reopen are user-only; versions are append-only; execution
labels are re-checked against real sandbox runs; one running agent run per project.

**What only the app enforces:** exit criteria, which transitions are offered, the
override reason beyond skips, and Go's pause rules (L-31).

**Autonomy levels already exist.** Go's Guided / Checkpoint / Autonomous are the
three levels discussed — the user works stage by stage; PromptMaster progresses and stops
at important decisions; PromptMaster works underneath and stops only when it needs the
user — and the database fixes what each may record (`workflow_events_agent_authorized`,
`agent_runs_guard`).

**Agents running underneath PromptMaster** needs, beyond what exists:
1. the Go loop on a server rather than in the tab (L-B4). The pieces exist — the `jobs`
   queue with leases and a cron drain, and `agent_runs.lease_holder` / `heartbeat_at` —
   but `use-go-loop.ts` and `perform.ts` are browser code;
2. one "where the project stands" view: what was done, what changed, what is blocked,
   what is next, what needs the user (today spread across the Go panel, the stage
   checklist and the needs card), and a way to reach the user when it does.

**Outside agents connected to PromptMaster** needs:
1. an agent identity distinct from the user (an `agent_principal` on events and steps),
   so an agent's moves are not recorded as the user's own;
2. the engine's pure functions evaluated server-side before a write (L-31) — a Next.js
   route with ownership-checking `SECURITY DEFINER` writes, as `/api/jobs/drain` already
   does, keeps FastAPI stateless;
3. a small API: read the projected state and permissible actions, propose an action
   (a pending recommendation), submit a result (a version or evidence).

Neither direction changes the record or the guarantees above; both add a way in.

### Project state model (2026-10-05)

On 4 Oct the client asked for the project's state to be held as four kinds of truth,
each with its own rules for change: what the human wants, what the project knows, what
has been authorised, and what has been done. This is where each lives today, and where the
gaps are.

| Kind | Held in | Who may change it |
|---|---|---|
| **Intent**: objective, constraints, audience, format, context, critique dials | `projects` | the user (patches with a `revision` guard) |
| **Knowledge**: figures, evidence, results, literature | `artifacts.key_figures` (only values found verbatim), `sandbox_runs`, review rows with `status_source` (`proposed` = PromptMaster's proposal, undecided until the user confirms; `model` = an outcome it may set; `sandbox`/`tool`/`user`), evidence-cited stage events | a model's rows are candidates until a lookup, a run or the user settles them |
| **Authority**: decisions, approvals, overrides, authorisations | `decisions`, `recommendations`, manual criteria (`projects.manual_checks`), Go authorisations | the user; a model only *proposes* (DB-enforced, above) |
| **Execution**: what ran and what it produced | `agent_runs`, `agent_steps`, `artifact_versions`, `workflow_events` | append-only; labels derived from what happened |

**Every write of stage work passes one commit check.** `appendStageVersion` runs
`checkCommit` (`lib/workflow/commit-check.ts`) before anything is appended. It refuses a
revision that is empty, text where the stage holds a table, or a table with no rows
(L-36). Code also checks that figures have a source
(`lib/workflow/figure-support.ts`, L-37); a figure without one becomes a finding rather
than a refusal.

**Go is driven by the stage's own requirements first** (`requiredWork`,
`lib/agent/needs.ts`):
1. finish a cut-off draft;
2. once only the user's approval is left, apply the open findings;
3. check the result;
4. ask for the approval.

The planner chooses only among what remains. A repeated move counts as a loop only if it
changed nothing (`noProgress`).

**The gap is dependencies (L-39).** Nothing yet records that a claim rests on a figure, or
a conclusion on a decision. So a change upstream marks whole stages stale rather than the
specific claims that depended on it. The intended shape is additive:
- a `links` table (`from_kind, from_id, to_kind, to_id, kind`), where `kind` is supports /
  derived_from / cites;
- written when a stage quotes an established figure, cites evidence or applies a decision;
- walked by a pure function that returns what is no longer justified (epistemic) and what
  must be redone (operational) — the same edges, read two ways.

Stable ids already exist on versions, rows and figures, so this needs no change to what is
stored today.

### Delegation, verification and change (2026-10-06)

The client's 5 Oct emails separate three kinds of gate: **validation** (does the work
meet the standard — PromptMaster checks it), a **delegable decision** (a choice the user
has authorised PromptMaster to make within bounds), and a **reserved decision** (the
user's judgment or authority). Delegation can satisfy authority; it never bypasses a
failed check. Assessment: `docs/assessments/2026-10-06-delegation-and-efficiency.md`.

| Concern | Where it lives |
|---|---|
| Validation | automatic exit criteria (`engine.ts`), the commit check (`commit-check.ts`), figure support, the source check (`verify_sources.py`) |
| Which approvals are routine | `ExitCriterion.authority` (`'delegable'` / `'reserved'`; absent = reserved) in template data; custom workflows from the designer's `approval_kind`, with new commitments as a separate reserved sign-off |
| Whether routine ones are delegated | `projects.routine_decisions` (`ask` / `handle`), set by the user (`routine_policy_changed`) |
| A delegated commit | Go's `commit_delegated`: `check-criterion` first, then a `criterion_committed` event as the run, then the box; the database checks policy and authority when the row is written (`20261018000100`) |
| Safe commits | `checkCommit`: empty, prose-for-table, no rows, a dropped user decision (unless the user reviewed it), or a stale base are refused; each refusal is a `revision_refused` event shown on the stage |
| AI vs Human verified | review statuses `ai_verified` / `ai_not_supported` (a tool sets them, from the abstract, with the quote on the row) vs `verified` ("Human verified") |
| A change to the brief | `brief_changed` marks only the finished stages a one-call judgment names, with why; `brief_change_dismissed` keeps them |
| Cost of all this | `model_usage.operation` / `attempt` / `elapsed_ms` / `agent_step_id`; per operation and project on the admin page |

**Reading `status_source` and events together.** A row's status says what is known; its
`status_source` says who established it (`user`, `tool`, `sandbox`, `model`, `proposed`).
An approval says what was decided; the event says who decided it (`stage_marked_complete`
by the user, `via: go_approve` when given through Go, `criterion_committed` under the
policy). Neither ever promotes the other: approving a stage changes no row.

### Authoritative state, outstanding work and repair (2026-10-07)

The client's 6 Oct emails ask where accepted facts live, how every stage reads the same
current value, how a change invalidates and repairs dependent work, whether Go can do
routine repairs, and how completion is kept from contradicting open work. Assessment:
`docs/assessments/2026-10-07-authoritative-state.md`.

| Concern | Where it lives |
|---|---|
| Accepted facts and requirements | `project_facts` (`20261024000000`): append-only; a change is a new row with `supersedes`, which the insert retires; `source_kind` / `source_ref` / `accepted_by` |
| One read path | `PMInput.facts` (the current rows, sent by `inputsFrom`) → `project_context.facts_block`, carried by `context_block` into every prompt that has the context; `test_project_facts.py` holds it |
| Facts from chat | `record_facts` reply action; figures must be in the user's own message (`reply_actions._from_user`); recorded only on *Record* |
| A fact changed | the change check watches `facts` like a brief field (`use-brief-change.ts`); `brief_changed` keeps `before` / `after` |
| What is still open | `outstandingWork()` in `engine.ts`: stale stages, open findings, unconfirmed proposals, unmet blocking criteria, stuck stages, Go waiting, an unmet objective — read by the stage bar, recommendations, the finish dialog and Go's completion |
| What a later stage reads | each earlier stage's latest saved version in full (`digest.ts` `documentText`, budget `DOCUMENTS_MAX`), rendered by `saved_documents.py` for generation, checks and chat; a reopened or stale stage is shown, labelled |
| A revision reopens later work | `stage_version_saved` (`20261026000000`), written by `appendStageVersion` when done stages follow; `projectState` marks them stale with the change named; the recheck notice reports it |
| Is the objective met | `/api/agent/assess-objective` before Go may say so; recorded as `objective_assessed` (`20261023000000`); "met" needs a verbatim quote, "performed" only recorded steps |
| Repair | Go's `recheck_stage` (stale stages up to the current one, earliest first) and `confirm_proposals` (under `handle`, `status_source: 'policy'`) |
| Ongoing work | `WorkflowTemplate.execution` (finite/ongoing, success criterion, stop conditions); a custom stage's `loop_to`; Go starts the next round under Autonomous + `handle` (`20261025000000`) |
| Designing a workflow | `generate-workflow`, then `revise-workflow` for targeted changes (operations applied in code; unsupported requests said) |
| Creating from a conversation | `/api/front-door` keeps a draft brief; its facts are recorded only after *Create project* |

### Research under Go (2026-10-09)

The client's 9 Oct email asks for Go to manage a research project from a bare goal:
do the work it can, stop only when it must, go back when the analysis asks for more,
and say what it did. Assessment: `docs/assessments/2026-10-09-research-go-and-branching.md`.

| Concern | Where it lives |
|---|---|
| Runs Go can carry out | runs rows' `producible_by` (`stage-artifact.ts` `producibleBy`, `awaitsAttempt`); `policy.runAttemptsFor`; `needs.requiredWork` → `run_computation` per row; a failed or impossible run is recorded on its row (`perform.ts` `setAsideFrom`) and the run continues |
| Stopping only when it must | `lib/agent/stop-audit.ts` (`auditStop`, `proposedDefault`); a question naming its own default is answered by it under `handle` and recorded as a policy fact (`recordRoutineDefault`, step `routine_default`); approval cards offer "Carry on with other work first" |
| Going back | `return_to_stage` (both registries); offered by `policy.returnTargets` when the saved text asks for more (`asksForMoreWork`), under Autonomous + `handle`, at most `MAX_RETURNS`; the database checks it (`20261029000000`); the work is added to the earlier stage as a version, which reopens what was built on it |
| Repetition | a repeat preemption carries `repeating`; the loop withdraws those moves once (`reconsiderNote`); saving an unsaved reasoning result is exempt from the polish cap |
| Expert judgment | `/api/agent/expert-package` (`promptmaster/expert_review.py`): working quoted verbatim from the record, executed only where a sandbox run is on record; shown on the question card (`expertPackage`) |
| Human-only work | `lib/workflow/human-requirements.ts`: rows naming it need a person; `failedChecks` holds the objective until the user's fact reports a result |
| The account | `lib/agent/account.ts` → `RunAccountCard`: did / now (working, window, blocker, decision, complete) / set aside, from the steps |
| Adapting the structure | optional stages skipped by Go under `handle` (`20261030000000`); Research v11's Final review may return to Analysis or Experiment |

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
