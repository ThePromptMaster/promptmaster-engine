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

## 3. A length is counted, never estimated (#661, #666, L-237)

| Change | Where |
|---|---|
| A check stage is given the counted length of each text it checks, as a plain line that is neither met nor unmet | `stage-requests.ts` (`checkedCounts`), `measured.py` (`info`) |
| A check row that only estimates a length code has counted is dropped before the table is saved | `stage.py`, `measured.py` (`is_hand_count`) |
| The final check is given the document's count, and is told a length is never its to judge and a text is never asked to state its own word count | `perform.ts` (`checkDeliverable`), `deliverable_check.py` |
| An accepted change that asks for a length of the whole text is decided by counting it; the model reads only the rest of the change | `lib/agent/deliverable-check.ts` (`lengthRows`) |
| A not-carried verdict with nothing to show for it is dropped; the stop line leads with the accepted change and what is missing | `deliverable-check.ts` (`issuesFrom`) |
| On a round's working text a length is marked "not counted here" and counted when the document is written | `lengthRows(…, working)` (#666) |

| Check | How | Result |
|---|---|---|
| The client's saved check rows and final memo | Real model, local script, 4 runs before and after | The word-count finding called not carried 4 of 4 before, 0 of 4 after |
| The check stage is sent the counts | By hand on production: the same brief on a test account, on a six-stage workflow that works in rounds; the page's own requests read as they left (read only) | The check's request carried "Screening brief — length: 441 words" and "Screening analysis — length: 597 words", and again on the second round with the new count (638) |
| No row estimates a length | Database read of both saved check tables on that project | No row mentions a word count |
| The final check is sent the count | By hand on production, same run | At the end of each round the request carried the round's count; on the written memo it carried "Screening package — length: 184 words" and the brief's own limit, "Memo: at most 600 words: 184 words" |
| A text really over a length an accepted change asks for is flagged with its count | By hand on production. **Forced:** no check row asked for a length, so one row ("Cut the memo to under 150 words", accepted) was added to the check's model reply in the page; everything after was real | The row went to the final check marked "NOT met: 184 words, counted in code, against "under 150 words""; the assessment read "Accepted change i19 (Check) is not carried into Screening package: Cut the memo to under 150 words … its length is NOT met: 184 words, counted in code"; Go trimmed the memo; the next check marked it "met: 127 words" |
| No length stop, no word count in the sandbox | Database read of the finished run | "Met: every requirement holds; the measured ones were counted in code", with "Memo: at most 600 words — 127 words"; no code was run in the project |

**Found in the pass, and fixed the same day:**

- The round check read "$3.5 million − $600,000 = $2.9 million" as 3.5 − 600,000, reported "works out to -599,996.5, not 2.9", and sent the work round again twice before the run was stopped by hand. The arithmetic check now reads a scale said after a figure (#665). After the deploy the same memo, with the same sum in it, finished with no slip reported.
- Deciding a length in code had a side effect where the work goes in rounds: the check at the end of a round reads everything the round wrote, so "cut the memo to under 600 words" would have been counted against the round's 2,900 words and failed every round. It had not happened yet. On a round's working text the length is now marked "not counted here" and counted when the document is written (#666).

Not run by hand: a not-carried verdict with nothing to show for it being dropped (unit tests, and the 0 of 4 above); and #666 on production, because the round in the resumed run was closed by the two-rounds rule before its check ran (unit test only).

## 4. Asking once, first version (#662, #667, #668, L-238)

| Change | Where |
|---|---|
| One list of everything waiting on the user across the stages: approvals not given, findings nobody decided, rows carried forward as unmet, questions Go set aside; each with the stages it holds up | `lib/agent/user-queue.ts` (`userQueue`) |
| Items one answer would settle are asked as one question | `promptmaster/question_groups.py`, `POST /api/agent/group-questions`, `mergeQueue` |
| The list is shown under Go's stop, and each item is answered there | `question-queue.tsx`, `go-panel.tsx` |
| An answer is recorded once as a fact, and closes the rows and kept questions the settle check says it settles | `workflow-workspace.tsx` (`answerFromQueue`), `user-queue.ts` (`closedByAnswer`) |
| A question set aside is closed by a later answer that covers it; the planner is told what is already waiting and not to ask it again | `use-go-loop.ts`, `agent.py` (`waiting_on_user`) |

All on one test project on production: a proposal that had stopped on the old build at its final sign-off, with one question set aside two stages earlier ("Should the headings be numbered or left unnumbered?").

| Check | How | Result |
|---|---|---|
| A run paused before the change shows the list when reopened | By hand: the old build listed the question and gave nowhere to answer it (`media/nov12/08-…`); reopened after the deploy | "Also waiting on you", the question, an answer box (`media/nov12/09-…`), with no re-run |
| Carried findings join the list | By hand: two major findings set to Deferred with notes that only postpone ("I will confirm them next week") | Saving ran the settle check, which settled neither; both were on the list at the next stop with their notes and "holds up Check, Final and the finish" |
| One question for what one answer settles | By hand, real model | The two findings came back as one entry, "One answer settles 2 things", asking for the fees and their basis; the headings question stayed its own (`media/nov12/10-…`). On the next build the same call left the two separate; they do need different answers. Either is allowed: a group is a model's reading |
| The list still works when grouping fails | **Forced:** the grouping call answered with an error in the page | The three items listed one by one, in order (`media/nov12/12-…`) |
| An answer that settles part of a merged question | By hand; **forced** only in that the earlier grouping was put back as the reply. The settle check was real | "Fixed fee per session; the figures will follow." closed the per-session finding and left the fees finding open. Database: one fact naming one row; that row `settled_by` the answer with the fact's id; the other untouched |
| An answer that settles the rest | By hand, nothing forced | "Option A is $4,800 and Option B is $6,200, each a fixed fee per session." closed the fees finding ("the user supplied Fee A and Fee B, the figures the finding asked for") |
| The answer reaches the work | Database read | The change check reopened the draft that had been written "without knowing whether fees are fixed per session or per participant"; Go repaired the draft, the check and the final proposal, then stopped for the sign-off |
| The list stays after an answer, and keeps a question from an earlier window | By hand, after #668 | With the stop replaced by "Ready to carry on — press Resume", the list was still there, and the headings question set aside two windows earlier was back on it (`media/nov12/13-…`). "Unnumbered" closed it, and the list stayed with what was left |
| One stop at the end | By hand | After Resume, Go redid the draft, the check and the final proposal with the fees and the headings, and stopped once, for the sign-off, with nothing else on the list |
| The finish says what settled each deferred finding | By hand | "…settled by your answer: "Option A is $4,800 and Option B is $6,200, each a fixed fee per session"; … settled by your answer: "Fixed fee per session; the figures will follow"" (`media/nov12/14-…`) |

**Found in the pass, and fixed the same day:**

- A sign-off was offered a client's options. The proposal offers its client "Option A" and "Option B"; the sign-off "I approve this proposal to send to the client" was shown them as buttons (`media/nov12/10-…`). A sign-off is never given options now, and a plain English one is not sent to a model at all (#667; `media/nov12/12-…` shows it plain again). Real model on the saved texts, three runs each: 36 of 36.
- Any answer closed every item of its entry, including "figures to follow" and "I'll confirm next week". What an answer closes is now read item by item (#667). Real model on those rows: 15 of 15.
- The first answer took the rest of the list away until the next stop, and a question set aside in an earlier window was gone from it after the next Resume (#668).
- The list offered the final sign-off while the draft was still waiting to take the new answers in (#669).
- The run's account said "Question kept for you" three times for one question (#670).

**Seen in the pass, and left as it is:** after the sign-off Go asked one more question, whether to delete a duplicate line in the final proposal. "Yes" was recorded as a fact, the change check found the same line in the draft, and Go redid the draft, the check and the final proposal for it: three repairs for one deleted line, and the check, written again, raised a new major finding that needed one more press. That is the change check working as built (a change reaches every stage that states the opposite), and it is the costly side of it. Telling an edit to one text from a fact about the project is not something this work changed.

Not run by hand: an approval given, or decided, from the list, and an undecided finding accepted or rejected from it (component tests); the planner being told what is already waiting (prompt test); a question set aside being closed by Go's own reading of a later answer (unit test: on the test project the two readings that ran settled nothing, rightly).

## 5. A further pass on fresh copies (#672, #673)

The same day, after everything above was live: three fresh projects on production from the client's briefs (the A-or-B operations brief, the training brief, the acquisition memo), run end to end, and each item above that had only been tested in code looked at by hand.

| Check | How | Result |
|---|---|---|
| A decision, start to finish, on the final build | By hand: the operations brief, a new project | Go stopped at "I choose the recovery option" with Option A and Option B and the pinned "Choose an option" (`media/nov12/15-…`). A double click on Option A recorded one fact and one line on the decision trail. The next stop was the last, the final sign-off; no second A-or-B question |
| The "decision package" sign-off | By hand, same run | "I approve this decision package for internal use" was a plain "Approve and resume", with no options and no box (`media/nov12/16-…`) |
| An ordinary run | By hand: the training brief, a new project | Four sign-offs, "Finished: the objective is verified as met". Its coverage check raised no major finding, so the answered-finding case could not be repeated without forcing one (section 2 stands) |
| An approval given from the list | By hand: two approvals unticked on an earlier stage while Go waited on a later one | Both were listed with what they hold up (`media/nov12/17-…`); "Approve" on each gave it (database read) |
| An approval is held off the list while earlier work is out of date (#669), and a decision is made from the list | By hand: the decision reopened on the operations project | With the brief out of date the list was empty. Once it was current the list showed the decision with its two options and left the final sign-off off (`media/nov12/18-…`). Option B chosen there: the approval given, the fact, the line on the decision trail (database read) |
| A finding accepted from the list | By hand. **Forced:** one major finding was added to the check's model reply so that one was undecided | Listed as "Finding i29 on Check · holds up the finish" with Accept and Reject (`media/nov12/19-…`); Accept set the row accepted by the user (database read) |
| A length on a round's working text (#666) | By hand on the round workflow. **Forced:** the length finding was added to the check's reply; it was accepted by hand | At the end of the round the finding went to the check marked "not counted here: this text is the working of a round…", and was not reported |
| An unsupported "not carried" is dropped | **Forced:** one verdict in the check's reply set to not carried with no quote and no note | It appears nowhere in the round's verdict; the one real not-carried verdict, with its quote, does |

**Found in this pass, and fixed the same day:**

- Restoring the text from before a decision offers "Update the fact", and "Not yet decided…" then stands where the decision stood. Deciding again left it current beside the new decision, and a repair of the final package then failed its own check against the two. A new decision now replaces whatever replaced the earlier one (#672). Checked by hand afterwards: the new decision's fact supersedes the "not yet decided" one, which is retired.
- Under a decision's card the summary line said "Your decision is needed: "Approve and resume"", a button that card does not have. It says "Choose an option" (#672; seen by hand in `media/nov12/21-…`).
- With a decision reopened, Go did the other work first and then asked "Which recovery option do you choose?" as a question of its own, with the approval for the same choice on the list under it (`media/nov12/20-…`). Answering Go's question recorded an answer and left the approval unticked, and Go came back asking for the choice on the approval's card (`media/nov12/21-…`): the client's "it asked me again", in the other order. An answer that names one option of a waiting decision now gives that decision (#673). Checked by hand afterwards, nothing forced, on a fourth fresh project: the decision reopened the same way, Go again asked it as its own question (`media/nov12/23-…`), and the answer "Option B: …" gave the approval and was recorded once, as the decision, replacing "not yet decided". Go went on without asking again.
- A decision made again had begun to break repairs. Since it supersedes the earlier decision (#664), the check for old values still stated as current read the figures of the option not chosen as leftovers. After Option A ("take the carrier's 20 units for $2,400") became Option B, the brief and the decision stage, which rightly state the carrier's quote, failed their repairs on "$2,400", and the run ended "The last 2 steps failed". A decision, or the fact standing where one stood, now yields no superseded values (#674). Checked by hand afterwards: the failed project was resumed on the new build, all five stages passed their repairs, and it finished "the objective is verified as met".

**Seen in this pass, and left as it is:** after a decision is made again, the stages before it are marked for a recheck where the text of one states the earlier decision. The first decision leaves them alone (#660); a replaced one goes through the older rule that a stage stating a replaced fact is rechecked. The rechecks are cheap next to rewrites, and they are the only thing that corrects a stage that did write the old choice in.

Not seen by hand: one question listed once in the run's account (#670). No fresh run set the same question aside twice, and it cannot be made to.

## What this cost to check

About $26 of model calls on five test projects on a test account for the first passes, about $20 more on four fresh projects for the last one, and under $2 for the scripts run against the saved texts.

