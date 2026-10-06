# Delegated authority, safe updates, verification and efficiency — assessment

*6 October 2026. In reply to the eight emails of 5 October. The code it describes is in
PRs #139–#146; the limits it names are in `docs/known-limitations.md` (L-43 to L-50).*

The short version:
- **Built.** The three kinds of gate are now separate in the product. Routine approvals
  can be delegated with one setting. A revision can no longer replace or quietly damage
  valid work. PromptMaster reads a source's abstract before asking anyone to verify it.
  A change to the brief reopens only what relied on it.
- **Measured.** Every model call now records what it was for, how long it took, and
  whether it was rework.
- **Not yet built.** Cumulative limits, investigating conflicting evidence, and
  claim-level dependencies. They are below, with what each needs.

---

## 1. The gates: validation, delegable decision, reserved decision

Sean's split (5 Oct, "Delegated authority and routine approval gates"):
- **Validation:** PromptMaster checks it.
- **Delegable decision:** PromptMaster may commit it under the user's policy, after
  validation passes.
- **Reserved decision:** the user's judgment or authority.

In the product:
- **Validation** is the automatic exit criteria, which are pure functions and never a
  model call.
- **The two kinds of decision** are the manual approvals. Each now says which it is
  (`authority` on the criterion).
- **The setting** is one control, beside Guided / Checkpoint / Autonomous: **Routine
  decisions: Handle them for me / Ask me**. The involvement mode still says when Go
  pauses; this says who may decide.

| Workflow · stage | Approval | Class | Why |
|---|---|---|---|
| Book · Objective | it says what success looks like | delegable | checkable in the text |
| Book · Objective | it says what is out of scope | delegable | checkable in the text |
| Book · Audience | each group has prior knowledge and a reason to read | delegable | checkable |
| Book · Positioning | at least two comparable books named | delegable | checkable |
| Book · Positioning | **the one-sentence differentiator is stated** (blocking) | delegable | checkable — the one blocking box Go now commits in Book |
| Book · Positioning | a reader could tell whether the book kept its promise | delegable | checkable |
| Book · Research | open questions noted, or left | delegable | checkable |
| Book · Outline | every reader need has a section | delegable | checkable against the audience |
| Book · Editing | I am done editing | **reserved** | the author's call |
| Book · Final | I accept this manuscript as finished | **reserved** | acceptance |
| Research · Question | I can say what would count as an answer | delegable | checkable in the question |
| Research · Question | I can say what would show it wrong | delegable | checkable |
| Research · Literature | **this says what is not known, and this work addresses it** | **reserved** | a judgment about the field |
| Research · Hypothesis | **I accept these hypotheses as the working set** | **reserved** | a choice |
| Research · Method | **I approve this analysis plan for execution** | **reserved** | authorises execution |
| Research · Analysis | **I accept each verdict as supported by the evidence** | **reserved** | acceptance of a conclusion |
| Research · Mechanism | it explains why, or says the reason is unknown | delegable | checkable |
| Research · Generality | it says where the finding applies | delegable | checkable |
| Research · Final | I accept this write-up as finished | **reserved** | acceptance |
| Single output · Review | the prompt asks for what I want | delegable | checkable against the objective |
| Single output · Realign | the correction was applied | delegable | checkable |
| Single output · Summary | I accept this output as finished | **reserved** | acceptance |
| Exploration · Write-up | **I approve this as where the idea stands** | **reserved** | a judgment |
| Custom workflows | each approval | from the designer | routine only when it certifies something checkable against the material; **new commitments always get their own reserved sign-off** |

Bold marks a blocking approval: the ones Autonomous stopped on.

**"I approve these extracted claims and commitments"** was a custom workflow's single
approval, which mixed the two kinds. A designed stage that extracts supplied material now
gets two sign-offs:
- a routine check that the extraction matches the source;
- a reserved "I accept the new commitments it proposes", when the stage can introduce
  any.

**How a delegated commit works.**
1. Go sees that only a routine approval is left.
2. One small call checks the stage's text against it. Anything but an explicit "met" is
   "not met".
3. If met, Go records `criterion_committed` as the run, then the box is ticked. The
   checklist reads "Committed under your routine-decision policy, after checking: …".
4. If not met, Go revises toward it. It is not a question for the user.

**What the database enforces.** It accepts the commit only when, at the moment the row is
written, the project's policy is "handle" and the pinned template marks the approval
delegable. So narrowing the policy mid-run governs work already under way.

**When Go stops.** Reserved approvals still stop Go. The card says what is needed, why
the policy cannot cover it, and what answering unlocks.

**What waits.**
- Optional routine boxes are left for the user (L-49).
- Cumulative limits are not enforced (L-43).
- Projects on older template versions see every approval as theirs until they upgrade.

## 2. The ten acceptance tests

Each case is also code: `frontend/src/lib/workflow/acceptance.test.ts`. Built cases are
real tests; the rest are `it.todo` with their register entry.

| # | Case | State now | What to inspect |
|---|---|---|---|
| 1 | Routine extraction proceeds without approval | **Works** for the approval (D). The row-level "supported by supplied material" status is **not built** (L-46). | `criterion_committed` event, actor `system`, with the check's reason |
| 2 | A new commitment gets separate authority | **Works** for designed workflows (D): a separate reserved sign-off. Detecting a commitment the model *slipped into* an extraction is the check's reading, not a structural guard. | reserved card; no `criterion_committed` |
| 3 | Failed revisions preserve the valid artifact | **Works** (L1, G1). Empty, prose-for-table, no rows, a dropped user decision or a stale base are refused, shown on the stage, and recorded. Go retries within its two-failure bound. | `revision_refused` event; head unchanged |
| 4 | A factual change triggers downstream review | **Works, at stage level** (C1). Only the stages a one-call judgment names are reopened, with why. Repair is not automatic (L-45). | `brief_changed.affected`; rail "recheck" |
| 5 | A presentation change avoids rework | **Works** (C1). Caught in the browser, no model call, nothing reopened. | `brief_changed {kind: wording}` |
| 6 | Changed intent keeps calculations, reopens recommendations | **Works as a judgment** (C1). The call is told to keep computed results and reopen what was judged against the old priority. | `kind: intent`, `calculations_hold` |
| 7 | Pending work respects changed authority | **Works** for delegated commits: policy read per move and by the database. Approving a stale Go move does nothing. External actions: none exist (L-48). | refused commit after "Ask me" |
| 8 | Evidence conflict → investigation first | **Not built** (L-44). Sources are now read before the user is asked (V1), which is the first half. | — |
| 9 | Approval preserves evidence limitations | **Works**. A tick changes no row. Proposals stay proposals; AI verified stays AI verified. | row `status_source` unchanged after approval |
| 10 | Small decisions respect aggregate limits | **Not built** (L-43). Per-step cost is now recorded (E1), which is the data it needs. | — |

**Recommended order for what is left:**
1. aggregate limits (10), on the same database guard as the policy;
2. "supported by supplied material" on extraction rows (1), a registry change;
3. conflict investigation (8), a planner move with the lookup and read tools that exist now;
4. repair of reopened stages (4).

**Not shown by these tests**, as Sean says: that this beats a capable agent without the
governance layer. That needs the comparison in §5.

## 3. Safe state mutation and recovery

**Every new version passes one commit check.** A model's revision is a proposal until
then. Since this round, a revision the user did not review cannot:
- drop a row they decided;
- overwrite a version made after the revision began.

A refusal is visible on the stage and kept in the history (`revision_refused`). The
user's own edit, restore, or an accepted chat proposal can still do either.

**Recovery is two things.**
- **Project-state recovery exists.** Versions are append-only and restore appends. A
  refused revision leaves the current version. A reopened stage can be kept as it was.
- **Operational recovery** (an email sent, a commitment made outside) is not needed
  today, because PromptMaster takes no external actions. It will need its own
  permission, separate from routine decisions, and its own record (L-48).

## 4. Verification classes

The statuses now keep apart:
- what PromptMaster checked itself: **AI verified — the abstract supports it**, and
  **AI checked — the abstract does not support it**;
- what a person checked: **Human verified**;
- what was only found: **Retrieved** / **Source found**.

**How a source is checked.** The lookup button and Go both:
1. find the record;
2. read its abstract;
3. judge it, quoting the sentence relied on. Code checks the quote is really there.

Go does this before handing a source table to the user. The user is asked about what is
left: no abstract, abstract inconclusive, or abstract contradicts.

**The ceiling is the abstract** (L-47).

The other verification classes exist separately:
- machine-verified (execution labels checked against sandbox runs);
- independently reproduced (a status only a run or the user can set);
- human approved (events).

## 5. Efficiency

**What is realistic now.**
- **Context loading.** It is already selective:
  - each prior stage reaches a prompt as a ≤320-character summary, not its text;
  - the manuscript only reaches stages after drafting;
  - Go's planner gets a 12k excerpt.
- **Deterministic checks.** They replace model calls for:
  - exit criteria;
  - the commit check;
  - figure support;
  - wording-only brief changes;
  - most of Go's stop conditions.
- **Reuse.** Stage summaries and recorded figures are reused rather than regenerated.
- **Repair is scoped to a stage.** A refused revision is retried, not the project, and a
  brief change reopens named stages only.
- **Fewer approvals.** Routine approvals no longer stop Autonomous.

**What needs foundations.**
- **Repairing only the affected claims** needs a dependency graph (L-39). The `links`
  table design is in `architecture.md`. Until then a change reopens a stage, not a
  paragraph.
- **Using models appropriate to the task** needs routing. Every call uses the project's
  model today (L-50). The small calls are the obvious candidates: conflict check, figure
  extraction, criterion check, change impact, source verification. Routing should follow
  the measurement below, not precede it.

**Where the architecture costs more than it saves.** On short work (a Single Output memo)
the extra calls are pure overhead:
- the stage check;
- figure extraction;
- a criterion check per routine approval;
- change assessment.

On a long, changing project they are a small share of the calls, and a reopened stage
avoids regenerating the stages that did not depend on the change. That matches Sean's
prediction. How large each share actually is has not been measured yet; the
instrumentation below is what will confirm it or not.

**Measuring it (E1).** Every model call now records:
- its operation (a Go move, or the route);
- its time;
- whether it was a retry or a repair pass;
- the Go step it served.

Go steps carry their cost. The admin page shows cost and time by operation and by project.

The matched-task comparison Sean describes:
- **Tasks.** The same 3–5 tasks: a Single Output memo, a Research question with data, and
  a Book chapter with one mid-way change to the brief.
- **Runs.** Each run twice with the same model: once through PromptMaster under
  Autonomous with routine decisions handled, and once by the same model as a plain agent
  with the same tools and the same brief.
- **Recorded per run:**
  - model cost and time (`model_usage`);
  - steps and retries/repairs (`attempt`);
  - human review time (time between a Go stop and the user's answer, from
    `agent_runs` / `agent_steps`);
  - stages reopened.
- **Quality** is judged blind by a reviewer against the brief, so cost is compared at
  comparable quality and not by token count alone.

## 6. The research state model

The question was whether a workflow can be a human-readable projection of deeper state:
claims, obligations, artifacts, dependencies, decisions and next actions. It already
partly is.
- **Stage state** is projected from an event log.
- **Proposal and committed state are separate.** A model's output is a version that must
  pass the commit check. A status can be *proposed* and stays undecided until confirmed.
  A stage move by a model needs an accepted recommendation.
- **Execution truthfulness** is enforced. Labels are derived from what happened, and the
  database re-checks them against sandbox runs.
- **Several statuses are multidimensional already.** For example, `status` plus
  `status_source`, *AI verified* against *Human verified*, and execution labels.

**What the research specification adds, and the simplest form of each:**

| Spec concept | Simplest form here |
|---|---|
| Claims with scope and promotion/demotion | rows of a claim table, with status as the promotion ladder and `status_source` as who promoted it; demotion is a new version |
| Proof/research obligations | `project_tasks` plus unmet criteria — already what Go's `requiredWork` reads; a per-claim obligation needs the links table |
| Negative knowledge / dead branches | not built; a "falsified / do not retry, reopen if …" status on claims, read by the planner, is the small version |
| Evidence ceilings | built for sources (abstract-only AI verification, execution-only statuses); Go stops polishing via the polish cap — a per-claim ceiling needs the links table |
| Dependency-driven invalidation | stage-level now (C1); claim-level needs the links table |
| Project constitution | objective, constraints, context, routine-decision policy and template authority together are most of it; definitions, conventions and invariants as first-class fields would complete it |

**Recommendation.** Make the links table the next foundational change; it unlocks
claim-level invalidation, evidence ceilings and obligations together. Keep workflows as
the user-facing projection. Do not build a separate research platform: the research
case is the same state model with stricter promotion rules.
