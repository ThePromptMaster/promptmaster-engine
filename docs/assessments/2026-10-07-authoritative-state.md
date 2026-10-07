# Authoritative project state, consistent completion, and the workflow editor — assessment

*7 October 2026. In reply to the thirteen emails of 6 October. The code is in PRs #151–#160
(the PR list below says which PR built each item). The limits that remain are in
`docs/known-limitations.md`, L-51 to L-55.*

The short version:
- **What was missing.** PromptMaster had no record of its own for facts accepted during
  the work. Every readiness message looked only at the stage on screen. Go treated "the
  last stage has text" as "the objective is met".
- **Built.**
  - Accepted facts and requirements are recorded once, with their source, and every
    stage, check and chat reads the same list.
  - One function decides what is still open, and every message reads it.
  - Go judges the objective before it says it is met, and pauses on a named blocker.
  - Go repairs what a change reopened, and confirms routine proposals under your policy.
  - The workflow editor adds and edits stages, makes targeted changes, and says what it
    cannot do.
  - A project can start from a conversation.
- **Tested.** Your changed-requirement scenario (email 1), the candidate-facts scenario
  (email 4) and the research blocker (email 13) are now automated end-to-end tests.

---

## 1. The five questions (emails 5, 6 and 7)

**1. Where accepted facts and requirements are stored.**

Before this round:
- **Requirements** lived in the brief: objective, audience, constraints and output
  format, plus the project context (pasted or extracted material).
- **Results** lived in each stage's versions, with key figures recorded on each
  completed stage.
- **Nothing else.** A fact given in the side chat was written into the stage the chat
  was revising, and nowhere else.

That is the answer to email 6: in the candidate-facts test, only the finalist analysis
and recommendation were updated. No project-level record existed, so the final check
compared those stages against the project context and correctly found the figures absent.

Now there is a record: **`project_facts`**.
- One row per accepted fact or requirement, saying where it came from: added to the
  brief, from a file, from the side chat, an edit, or a stage.
- It says who accepted it: you, or PromptMaster under your routine-decision policy.
- It is append-only. Changing a fact adds a new row that supersedes the old one, and the
  old one stays in the history. Taking a fact out retires it; it is never deleted.

**2. How every stage gets the same current information.**

Every request the browser sends carries the current facts. One formatter puts them, as
an *ACCEPTED PROJECT FACTS AND REQUIREMENTS* block, in front of the project context in
every prompt. These prompts read the identical list:
- stage drafting;
- stage checks;
- the side chat and its actions;
- routine-approval checks;
- the objective check;
- Go's planner.

A test asserts that the block appears in each of them. The block says the facts are
authoritative, must not be called unsupported, and win over contradicting text. The
figure check counts them as supplied material.

**3. How a change invalidates and repairs dependent work.**

- **Invalidation.** Adding, changing or taking out a fact runs the same change check as
  an edit of the brief. One call names the finished stages that relied on it, with why,
  and only those stages are reopened. The text before and after is kept, so the previous
  brief can be read back.
- **Repair.** Go now treats a reopened stage as its next move. It revises the stage with
  the change and the current facts. It is told to keep every figure and calculation that
  still holds, replace superseded conclusions, re-test each option against the
  requirements as they now are, and begin with "What changed:". The result is saved as a
  new version (the old one is kept) and the stage is marked complete again. Completing it
  again reopens the finished stages after it, so the repair carries down the workflow.

**4. Whether Go can complete routine work within delegated authority.**

Under *Routine decisions: Handle them for me*, Go now:
- repairs reopened stages;
- confirms row proposals that stand as they are. Each row says "Confirmed under your
  routine-decision policy";
- commits routine approvals (built on 6 Oct);
- in an ongoing workflow, starts the next round. The database allows this only along the
  workflow's own loop.

Approvals marked as yours are still yours, and so are rows on a stage whose approval is
reserved (Analysis verdicts). A fact taken from the conversation is always recorded by
you, never by Go.

**5. How completion status is prevented from conflicting with unresolved work.**

One function, `outstandingWork()`, lists everything still open:
- stages reopened for a recheck;
- findings not accepted or rejected;
- unconfirmed proposals;
- unmet required items;
- stuck stages;
- Go waiting for you;
- an objective judged not met.

It counts these whatever the template marks as blocking. Every message reads it:
- **The stage bar:** "Ready to move on · 1 still open: Summary needs a recheck".
- **The recommendations:** they never say "nothing is outstanding" while something is.
- **The finish dialog:** it lists what is open. *Finish anyway* needs a reason, and the
  reason is recorded.
- **Go:** it will not say the objective is met.

## 2. What happened in each test, and what changed

| Test | What happened | Cause | Now |
|---|---|---|---|
| A/B/C (email 1) | Summary still recommended A; Autonomous stopped at three row decisions; "nothing outstanding" beside a recheck | Go worked only on the current stage; Summary's rows had no status PromptMaster could propose; readiness read only the current stage | Go repairs the reopened stage first, then confirms Summary's proposals under the policy; every message reads the same outstanding list |
| Candidate facts (email 4) | The final check called your figures unsupported; "Ready to move on" with the finding open; several row actions despite *Handle them for me* | No project record of the figures; findings default to non-blocking; proposals were never confirmed by Go | "Record these facts" from the chat, shown before saving; the record is in every prompt and in the figure check; open findings block plain *Finish*; proposals confirmed under the policy |
| Research, generated workflow (email 10) | Finished with five "next investigations" never attempted; chat inferred the stop reason | The designer turned an ongoing objective into a one-pass workflow; Go's completion meant "the last stage has text"; chat had no view of the run | The designer records *ongoing*, the success criterion in your words, and stop conditions, and adds a looping round; the objective check separates *performed* (only steps the run recorded) from *proposed*; chat is given the run record and told never to infer a reason |
| Research, explicit blocker (email 13) | "Objective met" over a log saying "Not met" | As above; the planner was also told a custom workflow "never needs data" | Go judges the objective first. Not met with a blocker: the run is **blocked**, and the project shows "Paused — the objective is not met. Waiting for: …" with what was done and what is only proposed. Inquiry workflows are told to stop and name what is missing |

The stopping condition in your two research runs follows from the code: Go's
`declare_objective_complete` checked only that the final stage was non-empty. I diagnosed
this from the code, not from the production logs of those runs. Section 8 shows the same scenario run on production after the fix.

## 3. Your acceptance criteria

| Criterion (email) | Built in | Held by |
|---|---|---|
| An authorised requirement change updates the brief and affected artifacts (1) | #155, #156 | `e2e/acceptance-changed-requirement.spec.ts` |
| Valid figures and calculations remain intact (1) | #156 | the repair instruction (unit test); production pass with the real model |
| Superseded recommendations are repaired consistently (1) | #156 | acceptance E2E: repair, then re-completion, which reopens what follows |
| Previous versions remain available (1) | existing, plus #155 | every repair is a new version; facts keep their history; `brief_changed` keeps before/after |
| Go handles routine repairs within delegated authority (1, 4) | #156 | acceptance E2E: `recheck_stage` then `confirm_proposals`, no row stop |
| Completion messages agree with unresolved work (1, 4, 13) | #153, #154 | `acceptance-oct6.test.ts`; `statuses` and `objective-outcome` E2E |
| Accepted evidence is recorded once with its source (4) | #155 | `e2e/facts.spec.ts` |
| Every artifact and check reads the same current evidence (4) | #155 | `test_project_facts.py` |
| A factual update invalidates and repairs affected work (4) | #155, #156 | `e2e/facts.spec.ts`, acceptance E2E |
| Cannot report "Ready to move on" while a check is unresolved (4) | #153 | `acceptance-oct6.test.ts` |
| An unmet objective with a blocker stays paused, keeps what is missing, and resumes (13) | #154 | `e2e/objective-outcome.spec.ts` |

## 4. Every substantive control (emails 2 and 3)

"Every substantive project action or state transition must read or update authoritative
structured state, with evidence proportional to consequence and an audit trail."

| Control | Reads | Writes | Evidence | Record |
|---|---|---|---|---|
| Draft / Regenerate a stage | brief, facts, earlier stages, key figures | a new version | commit check | version (`source_operation`) |
| Revise (side chat Change it, a reply action, Apply findings) | head version, brief, facts | a new version, shown first | commit check, base guard | version, instruction |
| Accept / reject a row; Confirm the proposals | the table | a new version; `status_source` per row | required reasons | version; `user` / `policy` / `model` per row |
| Tick an approval | criteria | `manual_checks` | — | workflow event when it closes a stage |
| Move on / Mark complete / Finish | criteria, outstanding work | workflow event, cursor | evidence version; a reason when overriding or finishing with work open | `workflow_events` |
| Skip, Go back, Reopen | template | workflow event | a reason for a skip | `workflow_events` |
| Edit the brief | — | the project row | change check | `brief_changed` (before/after, what it reopened) |
| Add / change / take out a fact; Record facts from chat | facts | `project_facts` | shown before saving; figures must be yours | the row itself (append-only) |
| Routine decisions setting | — | `projects.routine_decisions` | — | `routine_policy_changed` |
| Go | everything above | the same writes, as the run | each move's own evidence; the database checks authority | `agent_runs` / `agent_steps`, events citing the run |
| Check this stage | head version | an evaluation | — | `evaluations` |
| Check against the objective (Finish) | deliverable | stored on finishing | — | `project_finalized` payload |
| Attach a file | — | `project_files` | type and size checks | the row |
| Design / edit / publish a workflow | — | `workflow_templates` (immutable once published) | template validation | the version row |
| Create a project (including from a conversation) | — | project, initial facts | confirmation screen | `project_created`, fact rows |

**Buttons that still only launch a prompt.**
- *Challenge*, *Reframe* and *Self-audit* (under More) return commentary and write
  nothing. Their result reaches state only through a reply action the user accepts.
- *Ask* in the side chat writes nothing, by design. Its actions are the governed path.

Making these first-class means recording them as findings on the stage. That is a small
change and the next candidate.

## 5. Workflow customization (emails 11 and 12)

- **Proposed and adjusted before starting**, as today. Each stage can be edited
  directly: kind, purpose, instructions, required, the sign-off and who may give it, and
  a separate decision on new commitments.
- ***Add stage*** sits after every stage.
- **Ask for a change** ("add a verification stage after Analysis") changes only what it
  names. The model returns operations, and code applies them. What the engine cannot do
  is said as "Not possible: … — why": parallel branches, conditional routing, repeating
  part of a round, schedules, acting outside the project.
- **Finite or ongoing** is part of the design, with *Done means* and *Stop short of it
  when*. An ongoing workflow loops one round back.
- **Saved workflows** can be edited as a copy. Publishing makes a new version, so
  projects on the old one are unaffected.
- **Length limits:** the workflow box, Guide answers and the side chat now take up to
  200,000 characters. That is not unlimited, because every character is paid for, but no
  one typing will reach it.

## 6. The conversational start (email 8)

The start screen offers three ways in:
- *I know what I want to do*;
- *Guide me* (one question at a time);
- *Keep this as a conversation for now*.

In the conversation, PromptMaster asks at most one useful question per reply, and a draft
brief builds up beside the chat. It covers objective, audience, requirements, facts you
gave, deliverables, stages and approvals. A figure you did not give is dropped in code.

*Ready to create* says: "I'm ready to create this project. These facts, requirements and
decisions will become its initial authoritative state." *Create project* then goes to the
workflow choice, where everything is still editable. On creation, the facts and
requirements become the project's first `project_facts` rows, marked as from the chat.

## 7. Attachments (email 9)

It was not you. I reproduced it on production:
- A file whose name has an accent, a dash or curly quotes (`Résumé – “final”.pdf`) was
  refused by storage as "Invalid key".
- On the start screen, that one refusal deleted the new project.

Now:
- The stored key is a safe form of the name, and the name you see is unchanged.
- A file that fails after the project exists is reported, and the project is kept.
- The side chat has its own *Attach* button.

## 8. Checked on production with the real model (7 October)

Each phase was merged, deployed and then run on production before the next one.

| Scenario | What PromptMaster did |
|---|---|
| Accented file name (email 9) | `Résumé – “final”.pdf` on the start screen created the project with the file; the same name as a Word file attached from the side chat, and its text went into the context |
| 10,000-character workflow description (email 12) | Accepted; the designer returned six stages |
| Regge Hessian, formulas not supplied (emails 10 and 13) | The Summary said the computation could not be done. Go asked for the missing inputs, then judged the objective: **"Paused — the objective is not met"**, waiting for the four named inputs. It listed *Done: draft_stage* and *Proposed, not done: supply the missing setup*. The side chat, asked why Go stopped, answered from the run record and said nothing was computed |
| Candidate facts (email 4) | The side chat said nothing is recorded until confirmed and offered "Record these 2 facts". Both were recorded "from the side chat". Go drafted the recommendation with the exact figures; the objective check quoted them; nothing flagged them as unsupported |
| A/B/C with the added requirement (email 1) | The requirement reopened Input, Review and Output, each with its reason, and the stage bar listed all three. Go repaired them in order. Output now begins "What changed: kept the original subject, figures … replaced the conclusion that Project A should be chosen", chooses **B**, excludes **A** for using all three researchers, and says **C qualifies**. Version 1 is kept |

Two things the production runs found, fixed the same day:
- **#159.** With Go waiting on a question, the stage bar still said "Ready to move on". It now lists "Go is waiting for you". The step that judges the objective was titled "Objective complete" even when it paused; it is now "Check the objective is met".
- **#160.** After repairing three stages, Go stopped with "chosen 3 times in a row … without changing it". Each repair had saved a version, so it now counts as progress.

## 9. Hours

These are engineering estimates for this round, not timesheet figures.

| Work | Estimate |
|---|---|
| Attachments and length limits (#151, #152) | 4 h |
| Outstanding work and consistent completion (#153) | 6 h |
| Objective check, paused state, chat run record (#154) | 8 h |
| Facts record, one read path, chat recording, change check on facts (#155) | 12 h |
| Go repair and policy confirmation (#156) | 8 h |
| Workflow editor, targeted changes, finite/ongoing, Go's next round (#157) | 12 h |
| Conversational start, this assessment, register (#158) | 8 h |
| Production verification of the three scenarios with the real model | 4 h |
| **Total** | **≈ 62 h** |

**Still to do** (L-51 to L-55), with estimates:

| Work | Estimate |
|---|---|
| Go proposing facts from files and stages | 6 h |
| Per-claim dependencies, so a fact reopens only the claims that used it | 20–30 h |
| An objective check at the end of each round, so Go stops on success | 4 h |
| "Paused" on the projects list | 2 h |
| Challenge / Reframe / Self-audit as recorded findings | 4 h |
