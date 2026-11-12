# Five notes from 10–11 Nov: a decision with no options, an answered finding that kept blocking, a word count by eye, and asking once

12 November 2026. What was asked, what the client's own runs showed, what changed, and how each change was checked. Limits are in `docs/known-limitations.md`, L-235 to L-238.

## What the runs showed

Read from production (SELECT only) before any change.

- **The approval had no field for a choice.** Two projects stopped at a reserved approval that was a decision: "I approve this decision on the cap." and "I choose Option A or Option B (stating which one)." The stop was a tick with one button. On the second project the tick was given, Go set the A-or-B question aside, moved on, and asked it again on the next stage. A later run finished with "approval was given on v3; the current version is v5, so re-confirm it".
- **A choice pressed twice ended a run failed.** Two answer steps three seconds apart, two identical facts, the step in flight closed as "Interrupted", and the run ended with the database's "agent step … is finished and cannot change". This was not in the notes; it was in the same run.
- **The answered finding was a Deferred row with the answer as its reason.** The check asked "confirm absences or leave". The row was set to Deferred with the note "There are no additional absences to account for". No fact was recorded. A deferred major row always counted as "carried forward, still unmet", whatever its note said. Go repaired the deliverable twice for it and stopped; the stop offered "Carry on with the open work" and "Stop here". The note was reworded, which saved a new version, so Go repaired two later stages and stopped on the same row. The client's reading of it was right, and it was not a connection problem.
- **The word-count stop began in the check itself.** The brief said "under 600 words". The check read a draft no limit was attached to, so it was given no count. It estimated "560–600 words, by hand reading only" and its suggested change ended "Then state the word count, labelled as an estimate". Go accepted that as routine. The final memo was shorter and stated none, so the final check called the finding not carried three times, Go counted words in the sandbox twice, and the run stopped at the repair limit.
- **Go asked one question at a time, about the stage it was on.** An answer became a fact and reached every later prompt, and finished stages that relied on the opposite were reopened. It closed no finding, question or task. Questions "kept for you" were listed and never asked again. A project has one line of work; there are no branches.

## 1. A decision asks its question (#657, #658, #660, L-235)

| Change | Where |
|---|---|
| A second press of Go, Resume or an answer while the first is in hand is dropped; a run this tab is driving is never adopted over itself | `lib/agent/one-press.ts`, `use-go-loop.ts`, `decision-prompt.tsx` |
| The options a stage puts to the user are read from its own text, each with the passage that states it | `promptmaster/decision_options.py`, `POST /api/agent/decision-options` |
| Go's card and the approval on the stage show each option as a button, with a box for a decision that is none of them | `decision-options.tsx`, `needs-you-card.tsx`, `exit-criteria-checklist.tsx`, `use-decision-options.ts` |
| Choosing ticks the approval on its own stage, records the choice as a fact and on the decision trail, and reopens a prose stage so the decision is written in | `workflow-workspace.tsx` (`decideApproval`), `answers.ts` (`decisionAsFact`) |
| Every prompt is told what was decided; the approval is not asked for again after Go writes the decision in | `approvals.ts`, `project_context.py` (`approvals_block`) |
| A decision leaves alone the stages before it | `brief-change.ts` (`answeredOnStages`) |
| A choice is worded as the decision; never "(stating which one)" | `workflow_designer.py` |

No migration: the choice reuses `brief_changed`, `finalize` and the facts table.

| Check | How | Result |
|---|---|---|
| Options on the client's own stage texts | Real model, local script, 2 runs each | 14 of 14: both decision stages (and a third from a later run) gave Option A and Option B with their figures; three plain sign-offs gave none |
| A run paused before the change shows options when reopened | By hand on production: the cap brief on a test account, paused at the decision on the old build (`media/nov12/01-approval-one-button-before.jpg`), reopened after the deploy | The two options and the box, with no re-run (`media/nov12/02-approval-options-after.jpg`) |
| Choosing records the decision | By hand on production, then a database read | The tick on the decision stage's own version; a fact naming the approval and the choice; a `finalize` row with the choice; `brief_changed` on that stage; Go's rewrite as the next version |
| The decision is written where it said "awaiting" | Database read of the saved texts | No "awaiting" or "pending" wording left in the decision record; the final stage uses the chosen cap and both candidates it admits |
| No second question, no re-confirm | By hand on production | One more stop only, the final sign-off; the run ended "Objective met." with no re-confirm line |
| A sign-off with no options is the button it was | By hand on production, twice | "Approve and resume", no options, no box |
| The designer's wording | By hand on production: a new project from the A-or-B brief | The approval read "I choose the recovery option." and the card listed Option A and Option B with their figures |
| A typed decision, and two fast presses | By hand on production: "Option B, and customer service phones East…" typed, the button double-clicked | One fact, one `finalize` row, no answer recorded twice; the run carried on and finished "Objective met." |
| The stages before a decision are left alone | Database read on that run | The change check named one earlier stage and left it (`left_to_go`); nothing before the decision was reopened |

**Found in the pass, and fixed the same day:**

- The first run reopened the three stages written before the decision and reworked them, about a dollar of model calls (#660).
- The pinned copy of the stop still read "Approve and resume" beside a card of options, and ticked the approval bare (#663).
- A final sign-off on "this decision package" was offered a box for what was decided; and a decision made a second time would have left two decision facts current (#664).

Not run by hand: choosing from the stage's own checklist without Go (the only decision stage left unticked already recorded its decision, so it rightly showed a plain box; component test only until the next pass), and the pinned bar on an iPad-width screen.

## 2. An answer closes what it answers (#659, L-236)

| Change | Where |
|---|---|
| A row gains `settled_by` with the words that settle it; its status stays what the user chose; a settled or superseded row is not carried forward as unmet | `lib/workflow/settled-rows.ts`, `stage-artifact.ts` (`carriedRows`) |
| Each open finding is read against the user's own note, facts and decisions; settled only with words found there | `promptmaster/settled_items.py`, `POST /api/agent/settles` |
| Read when the user saves a note on a deferred row, and by Go before it repairs or stops for a carried row | `workflow-workspace.tsx` (`readOwnNotes`), `use-go-loop.ts`, `lib/agent/settle.ts` |
| The note becomes a fact; a version that only settles rows reopens nothing | `answers.ts` (`rowAnswerAsFact`), `settled-rows.ts` (`onlySettles`) |
| The stop on one carried row shows its note, an answer box, and "It is settled: carry on" | `needs.ts`, `needs-you-card.tsx` |

| Check | How | Result |
|---|---|---|
| The client's own row and notes | Real model, local script, 3 runs each | 20 of 21: his first note settled it 3 of 3; his reworded note 2 of 3; two postponements, a work defect and unrelated facts never; an answer recorded as a fact 3 of 3 |
| The stop he saw, reproduced | By hand on production, old build: the training brief on a test account, the finding deferred with his note. **Forced:** the check on that copy raised no such finding by itself, so one model reply was altered in the page to include it; everything after was real | Go repaired the brief twice for the row and stopped asking for a steer (`media/nov12/03-deferred-finding-stops-before.jpg`) |
| Resume after the deploy settles it | By hand on production, same project | A step "Close what your answer settled"; the row kept Deferred and gained `settled_by` "There are no additional absences to account for."; saved as `agent_triage`; no stage reopened by that version; the run went on (`media/nov12/05-settled-by-your-answer.jpg`) |
| "Keep it open instead" | By hand on production | The row was open work again, and neither a save nor an earlier fact closed it a second time |
| A note that only postpones | By hand on production: "Will confirm with HR next week." | Not settled on save |
| A note that answers | By hand on production | Settled on save, with "Keep it open instead" beside it; the note recorded as a fact (`media/nov12/06-note-saved-settles-keep-open.jpg`) |
| The stop on an open carried row | By hand on production, under "Ask me" | The row, "Your note on c13: …", an answer box and three buttons (`media/nov12/07-stop-card-settle-from-here.jpg`); "It is settled: carry on" with a typed answer recorded the fact, settled the row by it, and the change check reopened the brief that had relied on the open question; the run finished "Objective met." |

**Seen in the pass, and left as it is:** after an answer was on record as a fact, a later note that only postponed was settled by that earlier fact. The record did say there were no absences; "Keep it open instead" overrode it. It is noted in L-236.

Not run by hand: "Have Go work on it again" and "Stop here" on the new card (they are the buttons the stop had before, renamed), and Go leaving a readable row alone under "Ask me" (the row in that run had been kept open, which no policy reads; the policy branch is in code only).
