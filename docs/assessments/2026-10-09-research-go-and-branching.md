# Research under Go, and branching alternatives — assessment

*9 October 2026. In reply to the emails of 6–9 October. Emails 1–14 were answered by
the 8 October assessment (`2026-10-08-handoff-and-completion.md`) and are live. This
covers email 19 (Research mode: let Go manage investigation, execution and continuation),
which is built (PRs #196–#205), and emails 15–18 (branching, cross-examination,
consolidation), which you asked to have assessed, not built. Remaining limits are in
`docs/known-limitations.md`, L-67 to L-69.*

The short version:
- **Email 19 is built.** Given a goal and no attachments, Go now:
  - carries out the runs it can (calculations, simulations, derivations) instead of
    marking them "not run" for want of a dataset;
  - takes a routine default rather than asking for one;
  - goes back to Experiment, or wherever the work belongs, when Analysis or Final review
    says more is needed;
  - sets a limitation aside and carries on with work that does not depend on it;
  - prepares an expert review package when only an expert can decide;
  - never lets an AI pass stand in for people;
  - tells you in three lines what it did, what it is doing, or exactly why it paused.
- **Branching (emails 15–18)** is about half there. The project record is already an
  append-only history with a replayable event log, a fact ledger with provenance, and
  invalidation of work built on changed versions. What is missing is a project that can
  hold more than one line of work: a fork, a comparison, and a combination.
- **The smallest useful milestone** is two alternatives from one saved state, compared,
  and a combined version proposed, verified and continued, using the machinery that
  already exists. It is §3.4, about 9–12 days.

---

## 1. Email 19 — what Go does now

| You asked | Before | Now | PR |
|---|---|---|---|
| Give it a goal, no materials | Worked, but every run without data was "not run" | Rows say who can carry them out; Go runs the ones PromptMaster can, in the sandbox, with no dataset | #196 |
| "A missing output alone shouldn't … become a request for the user" | "Not run" counted as settled | A row PromptMaster can produce stays open until Go has tried it; a failure is recorded on the row with the real error | #196 |
| Exact limitation, continue independent work | Any blocked step ended the run | A blocked row is set aside and the run goes on; it stops only when nothing independent is left | #196 |
| Audit the need to stop | Only the current stage was checked | Before a question, Go checks required work, whether the stage can move on, and whether the question is yours; under "handle" a question with its own default is answered by that default and recorded as a fact you can change | #196, #198 |
| Return to Experiment when Analysis needs more | Only you could go back | `return_to_stage`: Go goes back where the work belongs (Experiment, Method, Literature, Alternatives), adds the work, carries it out, and later stages are repaired from the new results | #197 |
| Recognise repetition, reconsider | A loop guard stopped the run | The first loop withdraws the repeated moves and asks for a different kind of move; the second stops | #197 |
| Expert judgment | Free-text question | An expert review package from the saved record, with Copy and Download | #199 |
| No AI substitute for human coders | Not recognised | Human-only work needs a person; the objective is not met until a human result is on record | #199 |
| Short account | One line about the last step | What ran, what was reasoned, what was written; whether this is a window, a blocker, a decision or completion; what was set aside | #199 |
| Adaptive structure | Fixed sequence | Optional stages Go judges unnecessary are skipped with the reason; Final review can send the work back | #201 |
| Proposed / attempted / executed / verified | Already distinct | Unchanged: labels come from what happened, and the database re-checks them | — |
| Pause at a resource limit and resume | Already distinct | Shown as "a resource limit, not a problem"; runs and repairs already made are not repeated | — |

What it does not do yet:
- **Add or reorder stages.** Different shapes of research (a pure derivation, a
  literature review) are served by skipping optional stages and by going back. A different
  sequence is a workflow you design or edit (L-69).
- **Decide whether a question needs an expert by understanding it.** That is recognised
  from its wording, and so is human-only work (L-68).

## 2. Your six acceptance tests, replayed on production

Two projects, both started from a bare goal with no attachments, under Research,
Autonomous, and "Handle them for me". I approved only the reserved approvals, as you
would. Each production finding was fixed and deployed the same day.

| Test | Result on production | Found and fixed on the way |
|---|---|---|
| 1. Goal, no attachments: clarify only what is necessary, gather sources, begin | **Pass.** *"Does a driven damped pendulum … become chaotic …?"*: Go searched OpenAlex itself and drafted Question and Literature. It asked nothing except the reserved approvals: the literature gap, the hypotheses and the analysis plan. | Earlier, Go asked for the pendulum's length, g and amplitudes while proposing a default (#198: it now takes the default and records it as a fact you can change). Method was refused as "incomplete" for lacking the final report's results (#198: completeness is judged per stage). |
| 2. A missing output the system can produce: do it, save it, check it, continue | **Pass.** First pendulum: "3 recorded from code that ran in the sandbox", with no data attached. Analysis quoted the computed periods, e.g. T(30°) = 2.0410 s for L = 1 m, which is correct. Second pendulum: after the fixes, each row was run in turn. | The draft called numerical integration "needs a tool" (#203). A long sweep hit the sandbox's 30-second limit, was not recorded, and was retried (#204: the code is sized to the limit; a timeout is recorded on its row and the next row is tried). |
| 3. Analysis needs more: back to Experiment, update analysis and checks | **Pass.** Analysis found a run missing ("At least one specific drive amplitude … is missing"). Go went back to Experiment, added the run, and carried on. Earlier in the same project, Go judged the runs too large for the sandbox and went back to Method to change the plan. That is the "choose the right response, not a fixed loop" behaviour you asked for. The three-return cap held. | Going back to Method left your approval of the old analysis plan ticked (#205: a return now asks for that approval again). On the first pendulum, Go reasoned about the result but did not save it, because the polish cap had removed "Revise" (#202). |
| 4. Unavailable source or tool: say exactly what, continue independent work | **Pass.** Each row that could not run is listed in the account with its reason: "Row 2: the computation did not finish within the code sandbox's 30-second limit; a smaller sweep or a shorter integration would fit". The run went on to the next row instead of stopping. | — |
| 5. Expert judgment: explain the dependency, prepare a review package | **Built and tested in the browser suite; not reached by the real model in these runs.** The package endpoint, the card, Copy and Download are tested end to end with the scripted model. The production runs were stopped before Go reached the semiclassical question. | — |
| 6. Pause at a resource limit and resume without repeating | **Pass.** "Paused at the end of this window — a resource limit, not a problem. Everything is saved; Continue picks up from here and does not repeat finished work." Continue resumed at Hypothesis with no step repeated. | An approval card offered only "Approve" when Go could have done other work first (#200: "Carry on with other work first"). |

**What limits heavy computation now is the sandbox's 30 seconds per run.** A sweep of 61
long integrations does not fit; Go now narrows it and says so, or records that it could
not run. The limit is a setting: 60 or 90 seconds would fit most research sweeps, at
proportionally more of the daily execution allowance (600 seconds per user). This is your
call.

## 3. Branching, cross-examination and consolidation (emails 15–18)

### 3.1 What the current architecture already supports

| Your requirement | Today |
|---|---|
| Viewing an earlier state changes nothing | Every saved version is append-only (a trigger forbids edits), and stage status is a pure fold of the event log (`projectState`), which can be replayed to any point. |
| Preserve history; roll back | Restore appends a new version; nothing is overwritten. Since #196 a restore also reopens the work built on the version it replaced. |
| Facts, decisions, constraints with provenance | `project_facts` (source, who accepted it, supersede chain); `decisions` and `recommendations` tied to versions; conflict choices recorded. |
| Invalidate checks whose conditions changed | Saving a version, changing a fact or the brief, or going back reopens the stages built on what changed (`stage_version_saved`, `brief_changed`, `stage_returned`); Go repairs them. |
| Proposed vs executed vs verified | Execution labels derived from what happened and re-checked by the database; AI-verified vs human-verified sources; derived vs executed runs. |
| Verify a result against the objective | Measured requirements in code, the objective check with a verbatim quote, outstanding work, carried-forward findings. |
| Specific pause reason and continuation | Window / blocker / decision / completion are distinct, and Resume continues from saved work. |
| Retry without duplicates | Event sequence and version numbers assigned by the database; a step cut off mid-way is marked interrupted and not repeated. |
| Cost accounting | Every model call is recorded with its cost, operation and step (`model_usage`). |

### 3.2 What is missing

- **More than one line of work per project.** There is no fork, no parent link, and no
  grouping of alternatives.
- **State at a point, as a whole.** Stage status can be replayed to any event. The brief,
  the facts and each stage's current version can be reconstructed by time, but not
  pinned to an event. A branch point needs all of them pinned together.
- **Recorded dependencies.** Which conclusion rests on which fact or result is
  established by matching text when something changes (L-39), not stored. Your
  requirement that "disproving a shared assumption should flag dependent conclusions
  wherever they appear" needs it stored.
- **Comparison.** The only diff today is a pending revision against the current version.
- **Merge and synthesis.** Combining findings exists within one version. Nothing yet
  combines whole versions or projects.
- **Agents working without you.** Go runs in your browser tab (L-B4). Branches explored
  in parallel, cross-examining each other, need a server-side runner and a budget shared
  across them; `budget_usd` exists on a run but is not enforced.

### 3.3 Proposed design

- **A branch is a project with a parent.** New table `project_branches` (`project_id`,
  `parent_project_id`, `branched_at`). `branched_at` records the parent's event `seq` and
  the exact version, fact and decision ids current at that point. A fork copies those
  rows into the new project, keeping their origin ids, and replays the parent's events up
  to that point.
  - Every existing guarantee applies to each branch unchanged: row-level security,
    append-only versions, invalidation.
  - Branches of branches come for free.
- **Compare** two branches stage by stage, showing differences in:
  - brief and facts (with superseded values);
  - accepted decisions;
  - each deliverable's text;
  - open items (`outstandingWork`);
  - execution labels: what each branch actually ran versus proposed.

  The common starting state is the branch point, so shared material is identified by
  origin id, not by similar wording.
- **Combine** has the two actions you described:
  1. **"Merge selected branches"** reconciles changes deterministically where they do not
     overlap, and lists each conflict for a decision.
  2. **"Combine strongest ideas"** is a synthesis call against a target objective you
     confirm first.

  Either produces a **proposed combined branch**. Each contribution carries its origin
  (branch, version, fact ids), what was excluded, and the conflicts. Newly generated
  material is labelled as a proposal with no verified status inherited. Shared evidence
  is counted once, by origin id.
- **Verify and continue.** The combined branch is checked like any project:
  - measured requirements;
  - the objective check;
  - the budget or schedule conflicts that only appear once the parts are combined.

  Accepting it makes it the line of work going forward. The stages it changed are
  reopened and repaired by the existing machinery. The original branches remain.
- **Cross-examination** (email 16) is a review step that reads another branch's saved
  version and records findings attached to that version id. A finding is a proposal; it
  never changes the other branch. Agreement between agents is recorded as agreement, not
  verification. A disproved shared assumption, once dependencies are stored, flags every
  conclusion that cites it.

### 3.4 Milestones, effort and operating cost

| Milestone | Contents | Effort |
|---|---|---|
| **M1** — reliable persistence, handoff, decisions, completion | Done in the 6–9 October rounds (#164–#199). Left: stored dependency links (below) | — |
| **M2 — smallest useful milestone** | Fork from a saved stage (two alternatives); comparison view; "Combine" (user-selected contributions, conflicts listed); proposed combined version with provenance; verification against the objective; accept → continue with repairs; original branches kept | **9–12 days** |
| M3 | "Combine strongest ideas" synthesis against a confirmed target objective; stored dependency links (`links`: conclusion → fact/result/version) so a disproved assumption flags every dependent conclusion | 7–9 days |
| M4 | Nested branches in the UI; cross-examination steps; a server-side Go runner so branches explore without a tab open; a shared budget across a branch tree (enforced `budget_usd`, limits on branch creation) | 12–16 days |
| Later | Next-investigation selection with recorded rationale and outcome; branch statuses (disproved / insufficiently tested / not pursued for resources); cross-project findings; measured process improvement | to be scoped after M4 |

**Operating cost** (current model prices):
- A fork is a database copy: no model calls.
- A comparison is computed in code. An optional plain-language summary of differences is
  one call (about $0.01–0.03).
- A combination with conflict detection is one or two calls ($0.02–0.10).
- Verification is the existing objective check plus any repairs of reopened stages: the
  same cost as today's "Update affected work" (typically $0.05–0.40).
- Agent-driven exploration (M4) multiplies a Go run's cost by the number of branches; the
  shared budget is what bounds it.

**M2 acceptance test.** Your workshop example:
1. Branch a saved plan into two alternatives.
2. Combine the schedule from one with the activities from the other.
3. The combined plan exceeds the budget. Verification reports it as a measured failure
   with both sources named, and blocks acceptance.
4. Resolve it with a recorded decision.
5. The affected deliverables are repaired and verified.
6. Both original branches and the combined version remain, each with its history.

A later test (M3) changes an upstream fact, and checks that:
- only the dependent conclusions in every branch reopen;
- unaffected work stays as it is;
- completion is withheld until the checks pass.

### 3.5 Limitations and a simpler alternative

- Until M3, **dependencies are found by matching text**. A conclusion that rephrases a
  fact can be missed.
- Synthesis is a model's proposal. That is why it never inherits verified status and
  always passes through verification.
- **A simpler first step** costs about 2 days: "Duplicate this project from here".
  Without comparison or combining, it already lets you explore an alternative safely. We
  recommend going straight to M2: the comparison and the proposed combination are what
  make alternatives useful.

## 4. Hours

- Email 19, Phases 1–4 and the fixes found on the production passes (PRs #196–#205): about 2.5 days.
- This assessment: about 0.5 day.
- Branching estimates are in §3.4.
