# Four notes from 8 Nov: agent setup, fewer stops, final-answer accuracy, depth by request

11 November 2026. What was asked, what the client's own runs showed, what changed, and how each change was checked. Limits are in `docs/known-limitations.md`, L-232 to L-234.

## What the runs showed

Read from production (SELECT only) before any change.

- **The run behind the "too many stops" note was Guided.** The Go panel opened at Guided. Handle was chosen, Go was pressed, and every step waited for a press, "Move to the next stage" among them.
- **On a book project "Do whatever is best" was answered six times** to questions of the form "shall I go ahead and fix this?".
- **The memo's faults were asked for by the final check.** The supplied fact was "Reported EBITDA includes a $600,000 one-time insurance recovery". The objective check proposed a task: say the margin failure "is conditional on the undocumented one-time classification". The memo then said so, and added that two favourable answers "could reverse the recommendation" while a supplied 24% stood against a supplied 20% limit.
- **A concise screening memo got seven stages**, two more added by Go, and 44 steps.

## 1. Agent setup (answer only)

Custom coordination, no agent framework. One planner-and-actor loop runs in the browser over a stateless backend; research, drafting and checking are moves of that loop. Server-side running and outside agents are estimated in earlier assessments and not built.

## 2. Go under "Handle them for me" (#647, L-232)

| Change | Where |
|---|---|
| Choosing Handle sets the level to Autonomous when it was Guided | `policy.levelFor`, `go-panel.tsx`, `use-go-loop.ts` |
| A choice with no wrong answer is settled by Go and recorded as a fact | `question_screen.py` (`routine_choice`), `question-screen.ts`, `perform.ts` |
| A model's flag does not pause moving on from a stage whose requirements hold | `policy.shouldPause` |
| New designs keep a sign-off for the user only for real decisions; the last is always the user's | `workflow_designer.py` |

Not changed: sign-offs on projects already running. Both reserved mid-workflow sign-offs on the client's project were ones the brief had asked for, so no rule could tell them from the rest.

| Check | How | Result |
|---|---|---|
| Handle switches the level | By hand on production | Guided + Ask me became Autonomous + Handle on one press (`media/nov11/p1-handle-sets-autonomous.jpg`) |
| A run under Handle | By hand on production, the client's brief | 24 steps, four stages, no stop; four sign-offs made by Go (database read) |
| The screen on the client's own questions | Real model, local script | 10 of 10: six handled, a budget choice, a fee, a scope cut and an approval for use still asked |
| The full designed process, start to finish | By hand on production, second pass: the client's brief on a five-stage designed workflow | 36 steps over two windows, the second started by itself; five stages and two stages Go added; one stop only, for the final sign-off "I approve this memo to share with the investment team" (`media/nov11/p1-full-process-stops-only-for-final-approval.jpg`) |
| "Ask me" still asks | By hand on production, second pass | Autonomous with "Ask me": stopped at the first sign-off, saying it is routine but routine decisions are set to "Ask me" |
| A routine choice settled by Go | Not seen on production | No such question came up in either run; real-model script only |
| The model-flag case | Unit test only | |

**Found in the pass:** Go added a stage to adjust the memo's wording. The stage was not shown the memo, its writer returned nothing usable, and the run stopped on two failed steps (`media/nov11/p1-run-ended-on-added-stage.jpg`). Fixed in #649: an added stage now reads what the later stages hold. In the second pass Go added two stages on the client's brief; both drafted, were checked, and the final memo was repaired from them.

## 3. Final-answer accuracy (#648, L-233)

| Change | Where |
|---|---|
| One rule with the user's facts and material: supplied is given; a result a supplied rule and figure fix is that result | `project_context.SUPPLIED_RULE` in `context_block` |
| Evidence words gain "Supplied"; "what would change it" limited to a different figure or a changed rule | `stage.py` |
| The objective check must not ask for such a condition; the final check has a section for it | `objective_assessment.py`, `deliverable_check.py` |
| A one-stage draft is checked when written, corrected once, checked again | `final-check.ts`, `use-final-check.ts` |

Real model, the client's saved memo and brief:

| | Old rules | New rules |
|---|---|---|
| Check flags the doubted supplied fact | 2 of 4 | 5 of 5 |
| Check flags "answers could reverse it" | 0 of 4 | 5 of 5 |
| Regenerated memo calls the result conditional on the supplied item | 4 of 5 | 0 of 5 |
| Regenerated memo says diligence could flip the result | 1 of 5 | 0 of 5 |

By hand on production: the client's brief through "Get a first draft". The draft was checked by itself, one point was corrected as version 2 with the earlier one kept, and the re-check was clean (`media/nov11/p2-first-draft-final-check.jpg`). Neither fault is in either version (database read). Second pass, the full designed process on the same brief: none of the final memo's five versions calls anything undocumented, unverified or conditional or says a result could be reversed. Its confidence line reads "High. The verdicts rest on supplied figures and simple arithmetic", and on the largest customer: "This answer reverses the concentration fail only if the figure turns out to be 20% or below." One diligence question still asks whether the records confirm the 24% figure, which the rule allows as later work. Not run on production: the note's "still open" and "could not be checked" states.

On a three-sentence thank-you note the check corrected two phrases ("you made it look effortless", "everyone left full and happy") because the brief from the conversation said to add a moment only if the user gave one. That is the rule as written; a user may find it strict.

## 4. Depth follows the request (#649, #650, L-234)

| Change | Where |
|---|---|
| One size decision: concise, standard or full. A rule for stated lengths, else one small call; never fails | `request_size.py`, `POST /api/size-request` |
| Planning routes: concise gets the one-stage workflow; larger is designed to its size (3–5 or 5–8 stages) | `app/projects/new/page.tsx`, `workflow_designer.build_workflow_prompt` |
| "Get a first draft": draft first; a larger request has the full process set up around it for one press | `take-full-process.tsx`, `lib/workflow/request-size.ts` |
| A one-stage project is sized again when its objective changes | same |
| A stage Go adds mid-run reads the text it is meant to change | `digest.buildStageDigest` |

The switch is one press, not automatic: re-pinning a workflow moves the project's stages, and a model never does that by itself (FR-02).

Real model, local scripts: ten requests sized, nine as expected (an email, the client's screening memo, a one-page summary and a question concise; a book, an open-ended investigation and a 40,000-word guide full; a multi-document rollout came out full where standard was expected). The designer gave a workshop proposal four stages at standard depth and six with no depth, and a book six stages at full depth.

By hand on production:

| Start | Result |
|---|---|
| A two-line email, planning route | "Quick answer", one stage, recommended and started; draft written; final check "nothing to correct"; no offer to grow (`media/nov11/p3-email-planning-route-one-stage.jpg`) |
| The client's screening-memo brief, planning route | "Quick answer", one stage (seven before). Recommended only; not started on this route |
| A market-entry report with seven parts, "Get a first draft" | Draft written, checked, one point corrected. Sized full; a six-stage workflow designed for it was shown preselected with the reason and no press (`media/nov11/p3-report-first-draft-full-process-offered.jpg`). One press switched the same project to it, recorded as the user's (`media/nov11/p3-report-after-one-press.jpg`) |
| The same report, planning route | A seven-stage designed workflow recommended. Not started |
| The email project's objective changed to a twelve-chapter handbook | Sized again, full by rule, and the full process offered |

**Found in the pass:** the workflow designed for the report writes in chapters, so the draft was not carried into it (`deliverable_stage_id` null), while the panel said "Your draft is carried in". Corrected in #650: the panel now says which case applies before the press. After such a switch the draft is no longer shown in the project. Also corrected: the rule's reason read "asks for 12-chapter".

Second pass, by hand on production, after #650 and #651 were deployed (CI green on `227de56b` first):

| Start | Result |
|---|---|
| A workshop proposal, "Get a first draft" | Sized standard; a four-stage workflow set up; one press switched it; the draft carried as version 1 of the deliverable (database read) |
| A thank-you note, "Build a plan with me" (the conversation) | One stage, with the four facts from the conversation; final check ran |
| "Choose the workflow yourself" | Book preselected; nothing sized or designed |
| The corrected panel | "The request asks for 12 chapters, which is long work"; for the chapters workflow, the draft is said not to be carried (`media/nov11/p3-chapters-workflow-says-draft-not-carried.jpg`) |
| The manual "Take this into the full PromptMaster process" on a concise project | Still there, and works |

## Third pass, 12 November: what had not been seen live, forced

The user asked again whether everything had been verified by hand. Three things had not, and they do not come up on their own, so they were forced in the page on production: the page's own requests were answered or altered in the browser, and everything after that was the real system. Deployed without waiting for CI, by instruction; CI ran last.

| Item | How it was forced | Result |
|---|---|---|
| A model's flag on "Move to the next stage" | The planner's real reply had its flag switched on | Go advanced without pausing; the step is recorded with the flag set and succeeded |
| A routine choice | The planner's reply was replaced with a layout question | The live screen answered `routine_choice`; Go did not stop and listed it as "Question kept for you". The stage was already complete, so the question was set aside and not decided in the text |
| The note "could not be checked" | The check call was answered with an error | Shown; the draft was left as it was |
| The note "still open" | The check was made to find an issue twice | Shown, with the corrected point and the one left (`media/nov11/p2-final-check-still-open-forced.jpg`). Seen unforced the same day on a real draft |

Not reached even when forced: Go deciding a routine choice in the text and recording "Chosen by Go". Under Handle the planner is asked only when a stage starts and after it is complete, and in neither state can a stage be revised. That step has a unit test (#654), and the screen's verdict and the "Do whatever is best" path it shares were both seen live.

**Found in this pass, and fixed:**

- After the one-press switch the carried draft sits on the last stage, and the stages before it could not see it. Go stopped under Handle to ask for "the existing proposal draft". Fixed in #653; on a fresh project both earlier stages' writers were handed the draft (9,458 characters), and Go drafted without asking.
- At the switch the setup and the designer saw the first 4,000 characters of the draft with nothing saying it was cut, and wrote "it stops partway through Day 4, so continue from there" into the project's constraints. Fixed in #655; on a fresh project the constraint read "The draft is finished, so nothing in it needs continuing or filling in."

**Seen in this pass, as designed.** Under Handle a designed workflow can still stop before the end: for major findings on a check stage, which are the user's; and for a routine sign-off that Go's own check refuses after its two rounds of fixes.

## What was not done

- Sign-offs on projects already running are unchanged (section 2).
- The switch from a first draft to the full process stays one press.
- Stages are not added to a running designed writing workflow, and a designed workflow does not shrink beyond Go skipping optional stages.
- A draft is not carried into a workflow that writes in chapters.
- Phases 1 and 2 were deployed on local checks while CI was still running; CI was green on the commit holding all three phases (`dbbbfb57`) before Phase 3 was deployed.

## Cost of the checks

About $2.20 for the first Go run on production and $2.70 for the second, and a few dollars of script and draft calls on top; the exact total is on the usage page.
