# Implementation audit: what is built, what is enforced, what is only proposed

*9 November 2026. Answers the audit request of 8 November. Paths are relative to the repository. `L-nn` entries are in `docs/known-limitations.md`.*

## The short version

- **Of the 13 capabilities asked about, 3 are implemented, 8 are partial and 2 are not implemented.** Nothing here needs a rewrite.
- **The rollout failure came from specific faults, now fixed.** A correct figure was rejected, a chapter plan could not be repaired, and chapters could not see the plan. Section 2 traces each one and separates what happened before and after the manual recovery.
- **Testing the fixes on production found more faults, and those are fixed too.** They are listed in section 2 so the record is complete.
- **What is enforced is narrower than what the product appears to do.** Facts, versions, execution claims and Go's permissions are enforced by code or the database. Much of the judgment is still a model's, including whether the objective is met and whether a change is material. Section 1 says which is which, capability by capability.
- **Recommendation: no more capabilities for now.** Run the product on real work, and spend the next money on the three partial items in section 7.

## 1. Implementation inventory

### 1. Versioned authoritative state: partial

- **Exists:** Knowledge and Execution are append-only, with current and superseded rows. Intent and approvals are ordinary project columns. The four-part model is a documentation table, not one store.
- **Enforced by code or database:** facts and their supersession (`supabase/migrations/*_project_facts*.sql`); versions append-only; recommendations forward-only; decisions select and insert only; finished steps frozen (`*_agent_runs.sql`).
- **Asked of the model:** that accepted facts outrank other text (`backend/promptmaster/project_context.py`).
- **Tests:** `facts.test.ts`, `fact-values.test.ts`, `test_project_facts.py`, `e2e/facts.spec.ts`.
- **Limits:** the objective is edited in place (L-27). `manual_checks` is overwritten JSON and a user's tick writes no event. Chapters are mutable with snapshots (L-25). Accepted facts that a later instruction changes are not rewritten: the instruction outranks them in the prompt (L-223).

### 2. Rules checked before a change becomes authoritative: partial

- **Exists:** every saved version passes a commit check (empty, prose for a table, dropped decisions, stale base), and a refusal is logged with the refused text. Go's saves also refuse stray working text and ID renames.
- **Enforced by code:** `stores/project-store.ts`, `lib/workflow/commit-check.ts`, `lib/agent/perform.ts`. This is browser code. The database checks ownership only.
- **Asked of the model:** conflict detection (`conflicts.py`, advisory), and the check before a delegated commit (`criterion_check.py`).
- **Tests:** `commit-check.test.ts`, `id-changes.test.ts`, `working-text.test.ts`, `test_conflicts.py`, `test_criterion_check.py`.
- **Limits:** shape, not quality (L-36). Go's revisions aren't checked against the objective (L-42). Working text is found by known phrases (L-219).

### 3. Dependency impact and selective repair: partial

- **Exists:** there is no stored dependency graph. A saved version reopens every later finished stage by position, a changed fact reopens the stages whose text states it, and other changes are one model judgment. Go repairs reopened stages earliest first and revises chapter plans with chapter ids kept.
- **Enforced by code:** `lib/workflow/engine.ts`, `fact-dependencies.ts`, `lib/agent/needs.ts`, `perform.ts`; ids held in `backend/promptmaster/long_form.py`.
- **Asked of the model:** which stages a change affects (`change_impact.py`), which sentences depend on it (`dependent_claims.py`, whose quotes are held in code).
- **Tests:** `fact-dependencies.test.ts`, `brief-change.test.ts`, `perform-outline-repair.test.ts`, `repair-loop-oct13.test.ts`, `sponsor-revision-regression.test.ts`, `e2e/brief-change.spec.ts`.
- **Limits:** reopening is stage-level (L-45, L-52). A manuscript repair rewrites every written section. Adding or merging chapters is asked (L-212). Repairs stop at the first stage that can't be settled (L-225).

### 4. Verification and approvals tied to exact versions: partial

- **Exists:** checks, stage evidence and objective verdicts name their version. A ticked approval records its version and any mismatch is shown, but the tick stays satisfied.
- **Enforced by code or database:** evidence must belong to the stage (`*_stage_statuses.sql`); verdicts apply to the head only (`check-verdict.ts`); objective verdicts reused only on the same version (`objective.ts`); outline approval is by version; a carried outline approval needs a prior user approval (`*_outline_approval_carried.sql`).
- **Asked of the model:** nothing decides this.
- **Tests:** `approvals.test.ts`, `reconfirm-approvals.test.ts`, `readiness.test.ts`, `supabase/tests/stage_statuses.sql`.
- **Limits:** the exit gate ignores versions, and approvals on an earlier version don't block finishing. They are listed, and "Ready" says "Not yet". A reserved approval stands through Go's routine repairs without re-asking. Nothing unticks automatically (L-117).

### 5. Human decision selection: implemented

- **Exists:** code settles most stops before the planner runs. Under Autonomous and "Handle them for me", a second model sorts the planner's questions into repair, real-world action, business decision, reserved approval or missing input. Anything unclear is asked.
- **Enforced by code:** `lib/agent/needs.ts`, `policy.ts`, `stop-audit.ts`, `question-screen.ts`, `lib/workflow/triage.ts`.
- **Asked of the model:** the screen itself (`question_screen.py`).
- **Tests:** `question-screen.test.ts`, `test_question_screen.py`, `stop-audit.test.ts`, `needs.test.ts`, `e2e/go-mode-stops.spec.ts`.
- **Limits:** the screen is a model's judgment (L-210). `touchesObjective` is a word list. Major or unrated findings go to the user unless the screen calls them routine.

### 6. Reserved decisions held by a person or role: partial

- **Exists:** approvals are reserved or delegable in template data, and the database refuses Go committing a reserved one. "Reserved" means the project owner: there is no named person or role. Text from connected accounts is fenced as not-instructions.
- **Enforced by code or database:** `workflow_events_agent_authorized` (latest in `*_outline_approval_carried.sql`); `perform.ts`; absent authority means reserved (`needs.ts`); third-party text is excluded from the screen's user words.
- **Asked of the model:** that content is material, not instructions (`project_context.py`, `precedence.py`).
- **Tests:** `table-commit.test.ts`, `delegation.test.ts`, `test_third_party_block.py`, `e2e/routine-decisions.spec.ts`.
- **Limits:** no named approver field exists. Instructions inside an attached document reach the planner as context (L-194). A tick is a client write with no database rule (L-31).

### 7. Truth changes versus work to redo: partial

- **Exists:** a change is classified fact, intent or wording. Wording-only reopens nothing. Code finds replaced values still stated. Every reopening nonetheless becomes the same status and the same repair.
- **Enforced by code:** `brief-change.ts`, `fact-values.ts`, `facts.ts`; a repair fails if an old value stays.
- **Asked of the model:** the kind of change (`change_impact.py`); which sentences depend on it (`dependent_claims.py`).
- **Tests:** `brief-change.test.ts`, `fact-values.test.ts`, `fact-reconcile.test.ts`, `test_change_impact.py`.
- **Limits:** a value not in a fact can't be found (L-213). Look-alike figures are handled by subject and working (L-224), with the limits stated there.

### 8. Validity checks scaled to consequence: partial

- **Exists:** model checks, deterministic checks, source-quote checks and sandbox runs all exist, and the objective record separates measured from assessed. Scaling is limited to finding severity and stage flags. No risk tier chooses the checks.
- **Enforced by code or database:** `measurable.ts`, `arithmetic.ts`, `figure-support.ts`, `evidence-claims.ts`; quotes held in `verify_sources.py`, `objective_assessment.py`, `deliverable_check.py`; runs server-written and database-checked (`*_agent_runs.sql`).
- **Asked of the model:** stage evaluation, criterion checks, the deliverable check, the objective check.
- **Tests:** `measurable.test.ts`, `arithmetic.test.ts`, `figure-support.test.ts`, `test_verify_sources.py`, `test_deliverable_check.py`, `test_objective_assessment.py`, `supabase/tests/agent_runs.sql`.
- **Limits:** consequence tiering is not built. `arithmeticSlips` reads simple sums only (L-213).

### 9. Proposed, attempted, executed, verified; document versus real world: implemented

- **Exists:** step labels come from what happened. The database rechecks execution claims against server-written runs. Failed and interrupted attempts keep their own status. Real-world actions a document names become open tasks, with a distinct finished status.
- **Enforced by code or database:** `lib/agent/labels.ts`, `outcome.ts`, `*_agent_runs.sql`, `readiness.ts`; open actions kept only if quoted (`objective_assessment.py`).
- **Asked of the model:** which real-world actions a document names; the planner's rule that the document is not the event.
- **Tests:** `labels.test.ts`, `outcome.test.ts`, `account.test.ts`, `readiness.test.ts`, `test_open_actions.py`.
- **Limits:** only code runs and simulations are database-checked. Real-world tasks are recorded, not followed up (L-211).

### 10. Bounded repair and resumable pauses: implemented

- **Exists:** code caps repairs, polishing, returns and model calls. A used-up window is reported differently from a block or a credit stop, and continues as a chained run. Interrupted steps cost no try.
- **Enforced by code or database:** `policy.ts`, `needs.ts`, `objective-fixes.ts`, `continuation.ts`, `credit-stop.ts`, `account.ts`; one running run and the chain ceiling are in the database.
- **Asked of the model:** nothing decides a limit.
- **Tests:** `policy.test.ts`, `needs.test.ts`, `credit-stop.test.ts`, `continuation.test.ts`, `supabase/tests/agent_run_windows.sql`, `e2e/go-mode-stops.spec.ts`.
- **Limits:** `budget_usd` has no enforcer. The loop needs an open tab (L-B4, L-218). "Try once more" grants are lost on reload, and a press works out the grant again.

### 11. Branching and cross-examination: not implemented

One line of work per project. Adjacent only: Copy project, read-only references, a Research alternatives table, and prompt-only reasoning moves. The design is in `docs/assessments/2026-10-09-research-go-and-branching.md`.

### 12. Objective to prompt, modes, drift, realignment: partial

- **Exists:** prompts are assembled in code from the objective, facts and mode text. Drift and mode adherence are model scores only, which code reads and uses to refuse an autonomous advance. Realignment is a manual rewrite on prose stages; the generated realignment prompt has no screen.
- **Enforced by code:** `prompt_builder.py`, `conversation.py`, the generated `needs_realignment` column, `check-verdict.ts`, `perform.ts`.
- **Asked of the model:** `modes.py`, `stage_evaluation.py`, `evaluator.py`, `realigner.py`.
- **Tests:** `test_stage_prompts.py`, `test_stage_evaluation.py`, `test_mode_deliverable_rules.py`, `test_precedence.py`. `realigner.py` has none.
- **Limits:** Go's check runs only on drafting stages, not review tables.

### 13. Proficiency tracking and certification: not implemented

Nothing exists beyond a questionnaire that orders the examples. It is on the roadmap only.

## 2. The rollout failure, traced (project 46f9a40d)

### Before any manual step

| What happened | Engineering cause | Fix |
|---|---|---|
| The correct $8,000 training cost was refused three times | The migration fact superseded $8,000. The exemption for worked-out figures couldn't read past bold in `= **$8,000**`, so a correct sum looked like the old price. | #583, then #613 after a second layout appeared in testing: a figure is matched by what it was for, and a sum counts wherever its result sits |
| The chapter plan was never repaired | Reopened outlines were excluded from repair. Go repaired the rest and said it does not revise that kind of stage. | #597: Go repairs the plan, keeps every chapter id, and carries the user's approval |
| Chapters were rewritten against the old plan | Go carried on past a stage it couldn't settle, and section jobs carried no earlier-stage text. | #594 gives chapters the current plan, facts and sources. #615 stops at the first unsettled stage |
| Working text appeared in the package ("= **$45,000**? see below") | Nothing checked a save for the model's own working. | #588: refused on a Go save, shown before applying on a chat change |
| "Repaired" was reported while the check had failed, and approval was offered with a major finding open | Any repair step that ran counted as repaired, and nothing gated an approval. | #601, #603: only a closed stage is called repaired, and approving past a major finding needs a recorded reason |

### After the manual recovery

| What happened | Engineering cause | Fix |
|---|---|---|
| All eight sections detached from the plan | Regenerating an outline issued new ids, because the model returned none. | #595: existing items are sent, ids survive, a title match is the fallback |
| Regenerating Document 4 ignored the Core plan | Section jobs couldn't see earlier stages. | #594 (verified: the regenerated table matched the Core plan's eight sessions row for row) |
| The outline's completion cited the old version | Completion was recorded against the wrong version. | #598 |

### Found by testing the fixes on production (9 November)

These weren't in the original reports. Each came from the same sponsor-revision test on a copy of the project.

| Finding | Fix |
|---|---|
| The $8,000 rejection came back in a table with the sum after the result | #613 |
| Two failed repairs ended the run, so the recovery card never showed | #614 |
| Go repaired later stages past one it couldn't settle | #615 |
| A long instruction was cut at 1,500 characters, so the sponsor's new role authority was called invented | #619 |
| Shortening the package made the longer chapters the "delivered" text, and the email limit was counted nowhere | #618 |
| The planner's reply was cut off at 900 tokens, and Go asked "what next?" | #608, #620 |
| A repair was failed for a line its final attempt had removed | #623 |
| "Try once more" made no attempt once a stage had used more than its two tries | #625 |
| The browser alert never fired on an autonomous run | #627, #628 |
| Go asked about 7% over a hedged word target because its edit limit was reached | #629 |
| A paragraph reporting old figures as superseded was failed as a leftover, which stopped one run | #631, #632 |
| A chapter came back as a plan and a request for approval instead of prose | #633 |
| The per-chapter word count included headings that only mention a chapter | #634 |
| The final check was never shown the brief's constraints, so it missed a deadline nobody supplied and money called committed | #635 |

## 3. Acceptance

Run on production, on john@ copies, with the original brief and the exact sponsor revision. Project 48929b9f is the final run, on Opus 5.5. Project be3a3047 is the earlier run on Sonnet 5.5, where each check was first exercised. The saved projects from the original reports were not touched.

**Limits of this evidence.** Failed repairs were forced by altering the model's reply in the page, and each is marked "forced" below. A browser permission prompt can't be clicked from an automated session, so the alert was checked with a stand-in for the permission and a simulated hidden tab. A locked screen wasn't tested. A second hand pass, on what the first had left to automated tests, is at the end of this section. Approving past a major finding was tried separately, on a sample project with three real open findings, because none was left open in these runs.

### The seven verification points

| Point | Result | Evidence |
|---|---|---|
| The valid $8,000 training calculation passes unchanged | Pass | The final package reads "8 sessions × $1,000 = $8,000", and the Core plan repaired first time |
| Superseded migration pricing is caught only where it applies | Pass | A line "Migration costs $8,000 fixed." was refused (forced). The training line beside it was left alone |
| Regeneration follows the current Core plan, and related documents are reconciled | Pass | Regenerated Document 4 matched the Core plan's eight-session table row for row, and Check and the package were then repaired |
| Failed repairs remain visibly unresolved | Pass (forced) | Sidebar: "A repair failed: it needs a steer". Summary: "Repaired Check after a change; could not repair Package." |
| Approvals are tied to the current versions | Pass | "Approved: On version 3; the current one is 9", and "4 approvals to re-confirm" |
| Final readiness handles unresolved major findings explicitly | Pass | On a sample project with three open major findings, approving needed a reason, the reason was saved with the three finding ids, and "Finish anyway" stayed disabled until one was typed |
| A user can recover from a failed check through a clear control | Pass (forced) | A correction typed into "Tell Go what to fix" removed the line and closed the stage on the next attempt |

### The nine acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| One sponsor revision updates every stage, including the outline | Pass | 7 of 7 repaired, from a single revision |
| Section identities are preserved | Pass | 8 of 8 ids unchanged |
| A complete eight-document package | Pass | All eight documents, 3,996 words counted in code against "roughly 3,000–4,000" |
| Superseded figures and stray text removed | Pass | Old figures appear only in lines labelled superseded. No working text |
| Saved arithmetic, allocation, coverage and dependencies are checked | Partly by code | Sums are recomputed in code. Allocation and coverage are the model's check. I confirmed them by hand on the saved table: 72 people, no session over 10, no office over its limit of 6 out at once |
| Routine repairs need no repeated approval | Pass, with one false stop | No approval was asked during the repair run. One stop came from a false failure, since fixed (#631) |
| Finished documents are told from unfinished actions | Pass | Status: "Document finished; real-world actions still open", with 13 actions saved as open tasks |
| Status is unambiguous | Pass | One status line, and Written, Checked, Approved and Ready shown apart |
| Failed repairs stop with a diagnosis and a way on | Pass (forced) | The card names the line and the fact, and offers a correction, keep, or open |

**Cost of the final run on Opus:** $13.63 in total, of which the first pass was $5.86 and the sponsor revision and its repairs $7.77. The original project cost $15.87 and still needed manual recovery.

### The final check, on the reported handoff text

A reported financial handoff said all fees were already committed and the reserve was breached, told the team to proceed, and gave the sponsor until Week 4. The final check had missed it. Each saved text below was run through the check once on Opus 5.5, without changing its project.

| Text | Before #635 | After #635 |
|---|---|---|
| The reported financial handoff | 2 items, both false, because the check couldn't see the brief | 4 items, including "All three are committed", proceeding while the floor is breached, and the Week 4 deadline |
| The reported event handoff | Not run | 2 items: the $40 ceiling against its one exception, and a date the check isn't shown, which is a false item. It did not flag the two reported problems, so #638 followed (below) |
| The accepted rollout package | Not run | None |
| A test copy that had passed | Not run | 3 items about one real hedge: it calls a rate the brief supplies "unknown" |

The deployed backend then returned the same three problems on a short text reproducing them. This is a model's judgment, so it shows the check can catch these, not that it always will (L-228).

**#638, the readiness check.** The reported event handoff said the event was deliverable once one hour was covered, while its checklist still had the trainer, room and equipment to book. It also costed an old suggestion of six more attendees on top of a total that had since risen. The check had a rule for each and caught neither. Readiness is now a check of its own, which reads each readiness sentence against every checklist and status table, and the old-suggestion rule says what to look for. The check no longer reports the date of a past decision as unsupported, because it isn't shown the project's history.

| On the reported event handoff | Before #638 | After #638 |
|---|---|---|
| Readiness against the checklist | 0 of 6 runs | 4 of 4 runs |
| Six more attendees on the new total | 0 of 6 runs | 4 of 4 runs |
| The false past-date item | 6 of 6 runs | 0 of 4 runs |

Half the runs were on Opus 5.5 and half on Sonnet 5.5. On the controls, the reported financial handoff still returned its three problems, and the accepted rollout package returned nothing on Sonnet and one timing mismatch on Opus.

### The second hand pass, 9 Nov

The first pass left these to automated tests. Each was then run on production, on john@ copies. "Forced" means the model's reply or the planner's next move was altered in the page.

| What | How | Result |
|---|---|---|
| The final check inside a Go run, on the reported event handoff text | Real, on Opus. Project 6084d9f2, with the saved text pasted in as a new version | Round one found 4 issues, including readiness and the six more attendees. Go asked one fair question, whether the budget was $6,140, because that decision wasn't on the copy. After the answer it repaired the verdict and the checklist and removed the six-attendee line, asking nothing else. It finished with the document done and 7 real-world actions open |
| What was still open after that | Same run | After its two repair rounds the check still found the email's send condition naming only the staffing hour, and a run-sheet setup time. Go listed both as limitations at the finish |
| "Go needs you" alert | Stand-in notification, simulated hidden tab, real Go stop | Sent: "Go needs you on …". The tab title changed to "Needs you: …". Go's finish then sent its own alert |
| Change this section | Real, on Sonnet | The first try found a bug: a long chapter's rewrite was cut off before its end and finished without the request (#640). After the fix, the sentence landed at the very end in one call, only that chapter changed, the old text was kept as a version |
| A chapter left cut off | Real text, asked for through Change this section | Shown as outstanding, "Every chapter is written: 1 cut off", no way to mark the stage complete, and the export carries "Cut off mid-sentence". Finish project stays available and lists it as open. Go's next run finished the chapter first |
| Regenerate on a whole chapter plan | Real, on Sonnet | All 4 ids kept, all 4 chapters attached with their text, nothing detached. The warning before it was out of date (#641) |
| The lines before removing or discarding a section | Real | Shown, and Put it back returned the chapter with its 4,808 words |
| "None has been independently verified" | Real, typed into a stage | Passes the evidence check. "We verified that none of the shipments failed" is flagged |
| Running out of credit | Forced | The run stopped at once and said so, the step counted as interrupted, not as a failed repair |
| Stray working text in a Go save | Forced | Refused, naming the line, and the current version stood |
| Stray working text in Change it | Forced | Shown in a warning before Apply |
| Item IDs | One real, one forced | A brought-back ID was refused, answered under the routine policy, retried once, then recorded with no question. A respelled ID was put back in code. Going back to a stage skipped this check, now fixed (#642), with a unit test only |
| Phone width | 390-pixel frame | Three pages, no sideways scroll, and the overall status shows on the phone bar |

Still not done: a locked screen, a real browser permission prompt, and the full eight-chapter book.

Screenshots are in `docs/media/nov9b`.

### The book

Four chapters on Sonnet 5.5 (project 44a05e38, $5.36), with a correction given afterwards. The original eight-chapter book has not been rerun.

- The chapters came to 4,208, 4,284, 4,371 and 4,783 words against a target of about 4,500, each with a complete ending.
- Continuation ran: the first drafts took 9 writing calls for 4 chapters, and no job was retried.
- The correction, Section 4 to Section 5, landed in all four chapters and in the finished guide.
- One first draft came back as a chapter plan rather than prose. The objective check caught it, Go rewrote it, and the section prompt was tightened (#633).
- Go's last stop is the objective check's "not met", a content critique of one worked example. It is waiting on its card there.

## 4. What is automated and what is left to the user

**Automated.** Drafting, checking and revising each stage. Finding which stages a change reopens, and repairing them earliest first. Finding old values still stated. Recomputing written sums. Keeping chapter ids through a plan repair. Recording real-world actions as tasks. Saying what each repair came to.

**Left to the user.** Reserved approvals. A decision the supplied facts don't settle. A correction Go couldn't make after its tries, through the repair card. Real-world work.

**Can routine prompts and manual recovery go?** Mostly. In the final test the approvals were the only stops, apart from what is listed in section 3.

**Several agents against the same requirements.** Partial. One loop runs in the browser and writes chapters in parallel background jobs from the same facts, plan and outline. Conflicts between what they write are found by the consistency stage, the deliverable check and the arithmetic check. There are no outside contributors, no per-agent identity and no proposal queue for them. This is the "external agents" estimate already sent (24 to 36 hours for a proposal and status API).

## 5. The user-experience items

| Asked for | Now |
|---|---|
| One clear next action | One primary button on each stop. Apply and continue steps aside while a repair has failed |
| Business decision or internal repair | Each stop is headed "Your decision" or "Internal repair: PromptMaster needs a steer" |
| Status that explains itself | One status line (repair failed, out of date, needs your decision, complete, document finished with actions open), and Written, Checked, Approved and Ready shown apart with their versions |
| Recovery that keeps the writing | "Tell Go what to fix" on the repair card, and "Change this section" on any section, with the current text kept as a version first |
| Consequences before acting | One line before approve, regenerate and discard. A reason is required to give a reserved approval or to finish past a major finding (L-229) |

## 6. Cost

Baseline, revision, review and repair, both on Opus 5.5:

| Where it went | The reported project | The final test run |
|---|---|---|
| First drafts (baseline) | $1.76 | $1.64 |
| Revision | $3.32 | $2.60 |
| Review and checks | $2.52 | $2.49 |
| Repair after the change | $5.02 | $5.40 |
| Rewritten chapters | $1.70 | Counted under repair |
| Planning | $1.37 | $1.50 |
| Chat | $0.18 | None |
| **Total** | **$15.87**, 191 calls | **$13.63**, 187 calls |

The reported project also needed a manual recovery. The final run did not.

The reported book cost $72.31. Its largest lines were repair at $27.22 and revision at $19.40, against $5.91 for first drafts. The four-chapter test cost $5.36: repair $2.24, review $1.18, first drafts $0.91, revision $0.60, planning $0.43.

Projects now show this split under "Where it went". Older section jobs count as "Other".

## 7. Recommendation

**Add no more capabilities for now.** In the final test one revision reached all seven stages and the approvals were the only stops, apart from what section 3 lists. Use it on real work, then spend the next effort here, in this order:

| Item | Why this one | Hours |
|---|---|---|
| 1. Repair only what a change touches (capability 3) | A manuscript repair rewrites every written section, and repair is the largest cost line in the reported project, the final run and the book | 16 to 24 |
| 2. Check tables in code (capability 8) | Allocation and coverage are still the model's check. This is the one acceptance criterion only partly enforced | 10 to 14 |
| 3. Hold approvals to their version at the gate (capability 4) | An approval given on an earlier version is shown, and "Ready" says "Not yet", but it doesn't block finishing | 6 to 10 |

That is 32 to 48 hours. The price is agreed separately.

**Not recommended yet.** Moving Go to the server (60 to 90 hours), until the browser version has had real use. A proposal and status API for outside contributors (24 to 36 hours). Branching and certification, which nothing in these tests needed.

**A regression test from this case.** `frontend/src/lib/workflow/sponsor-revision-regression.test.ts` holds the real rows and facts. It checks that one revision reopens all seven stages, that repair starts at the first and stops at the first it can't settle, that the correct training cost passes in both saved layouts and the old migration price doesn't, that saved sums are recomputed, that stray working text is refused, and that the status doesn't overstate any of it. It runs on every pull request. `frontend/e2e/acceptance-changed-requirement.spec.ts` holds the changed-requirement path in a browser with a scripted model. `frontend/e2e/go-repairs-outline.spec.ts` holds Go repairing a reopened chapter plan the same way: the same ids, the chapters still attached, and the approval carried with its source.

**Simplification.** Needed in three places, and no rewrite.

- **One question screen: done.** Go's questions pass one screen under Autonomous and "Handle them for me".
- **One status: done.** `overallStatus` is worked out once, in the workspace, and every surface reads it.
- **One repair-and-verify path: partly.** A repair now reports only what actually closed. But `lib/agent/perform.ts` (3,164 lines) and `components/workflow/use-go-loop.ts` (2,047 lines) still hold many special cases, each added for one failure. That is the main maintenance risk, and item 1 above is the natural time to consolidate them.
