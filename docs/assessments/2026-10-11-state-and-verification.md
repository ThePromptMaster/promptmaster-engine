# Saved work, project state and verification — assessment

*11 October 2026. In reply to Sean's eight emails of 10 October: the front door, the
lunch invitation, the consolidated beta findings (workshop, lunch, book, research),
the Book Critique sequence, and the onboarding test. Sean asked three things for each
example: can we reproduce it, is it intended behaviour that needs clearer wording, and
what fix and retest do we recommend. Out-of-scope items get an estimate before any work.*

The short version:
- **Every example traced to a cause in the code.** None needed a guess about the
  interface. Seven root causes cover all of them (§1).
- **The most serious one is confirmed:** an approved correction did not reach the
  project's facts. The prompts tell the model that facts outrank a stage's text, so Go
  "corrected" Wednesday back to Thursday, and the objective check, graded against the
  same stale facts, called the result verified.
- **The book handoff is also confirmed.** Go's planner read the chapters from the
  database. The stage generator read the page's copy, which lags behind the job queue
  that writes them. So the planner said "ready" while the stage said "no draft".
- **"Verified as met" was not "finished".** The check stopped Go without finishing
  the workflow, and its record named neither the version it read nor how each
  requirement was checked.
- **All fixes are in and tested.** Five PRs, #216–#220 (§3). Sean's retests are in §4.
  Two items are proposed with estimates rather than built (§5).

---

## 1. Root causes

| # | Cause | Examples it explains |
|---|---|---|
| R1 | A "Change it" revision saved a version and nothing else. The facts kept the old values, and every prompt says a fact outranks the stage's text. The conflict check could not compare an instruction with a fact. A restore did not touch the facts either. | Lunch invitation (emails 4, 5, 6.1) |
| R2 | Stages after Drafting were generated from the page's copy of the chapters. The job queue writes them to the database, and the page catches up only on reload. Go's planner read the database, so the two disagreed. | Book: Continuity, Critique and Fact-check said "no draft" while showing "ready" (6.2, 7.7) |
| R3 | A repair was not held to the rules other saving steps follow. It could report "saved" without a version being checked, it had no execution label, and a cascade of repairs never tripped the loop guard. | Book Critique repair loop (7.4–7.6) |
| R4 | "Objective met" stopped Go but marked nothing finished. The objective check's record carried no version, no criteria and no tools, so its fields showed dashes. | "Finished" beside "2 done · 3 to go" (2, 3); weak verification record (6.5, 6.8, 8) |
| R5 | Statuses PromptMaster proposed were shown to the planner as decisions. Revision applied them, and "all resolved" counted deferred rows. | Workshop Summary (6.4, 6.6); onboarding (8) |
| R6 | Wording came from fixed strings, not from the state. Examples: "Move to the next stage" on the last stage, "press Go" beside a Resume button, "BLOCKING — An output exists", "Ready is true" (the front door's prompt named its own flag), and three different "saved" messages. | 1, 3, 6.3, 6.10, 7.2, 7.3 |
| R7 | Interface gaps: the pinned Go bar covers text at every width; review tables have a 720 px minimum width; setup invented constraints; Go's reasons could name a button the page lacks. | 6.9, 6.11, 8 |

**Two causes we found that the emails could not see:**
- **6.7, drafts no Go step made.** The page drafts the current stage automatically
  when it opens. It did so even while a Go run was paused, so Realign and Summary got
  v1 drafts while Go was proposing to skip one and waiting for approval on the other.
  Those versions are recorded ("AI draft"), but no Go step accounts for them.
- **6.9, unrelated tariff content in the churn chat.** Nothing in the code explains it.
  Chat is scoped by project and stage, and no prompt contains tariff text. We need to
  read that project's chat rows to say more (§5).

## 2. Each example, as Sean asked

| Email | Reproduced? | Intended? | Fix |
|---|---|---|---|
| 1 Draft mixed with the explanation | Yes — the reply is one block of text | No | F5: a separate Draft block with Copy |
| 1 "Ready is true" | Yes — the prompt names the flag | No | F5: the flag is never named, and such sentences are removed in code |
| 1 Saved vs not saved | Yes — three messages | The behaviour is right, the wording is not | F5: one message — the conversation is a draft until Start |
| 2, 3 "Finished" with stages left | Yes | It is intended that meeting the objective lets Go stop; calling that "finished" is not | F3: "met on Output v3, but the workflow is not finished — still to do: Summary; optional: Realign" |
| 3 Dashes for Analyzed and Tools | Yes | No | F3: labelled *Analyzed*, tool *AI model*, event recorded |
| 3 Was the word count measured? | It is measured in code when the requirement is measurable; the record did not say so | — | F3: the record lists *measured in code* apart from *assessed by the model* |
| 3 Clarity vs Critic | Intended: Clarity is the project's mode, which Go uses; Critic is the stage's suggestion | Wording | F3: "Project mode: Clarity · this stage suggests Critic; Go uses the project's mode" |
| 4, 5, 6.1 Correction reverted, facts stale | Yes (R1) | No | F1: the revision offers to update the facts; Go refuses to undo the user's version |
| 6.2 No manuscript downstream | Yes (R2) | No | F2: the chapters are read fresh; a stage with no chapters is not drafted |
| 6.3 Title vs effect of a step | Yes | No | F4: a step says what approving it does, in code's words; the last stage reads "Mark the last stage complete" |
| 6.4 Proposals read as accepted | Yes (R5) | No | F4: marked as proposals to the planner, skipped by Revision, no "Accepted —" prefix |
| 6.5, 6.8 Weak record | Yes (R4) | No | F3: version, criteria, how each was checked, what was not verified; document and workflow changes listed apart |
| 6.6, 8 Deferred concerns vs "nothing needs another pass" | Yes | No | F4: "all decided · 3 deferred"; the finish message lists deferred items (follow-up, below) |
| 6.7 Drafts with no Go step | Yes — the page auto-drafted | No | F2: no auto-draft while Go is paused; every page draft says how it was made |
| 6.9 Invented button | Yes — reasons were not checked | No | F5 |
| 6.9 "Not run" retyping | Yes | No | F5: the reason comes from the row's "Needs data — …" |
| 6.9 "Reproduced" vs text | An old status or a user's choice; nothing checked it | — | F5: flagged, not changed |
| 6.10 "BLOCKING — An output exists" | Yes | No | F4: "Not yet: an output exists" |
| 6.10, 6.11 "later stages act…" on the last stage; "this draft" with no draft | Yes | No | F4, F5 |
| 6.11 Sticky Go panel, sideways tables | Yes | No | F5: one small button below `lg`; cards below `md` |
| 6.11 Suggested constraints | Yes — the setup prompt asked for them | No | F5: only what the user said; suggestions are labelled |
| 7.1 "Handle them for me" still asked | Intended for **major** findings — the setting covers minor and moderate ones | Needed explaining | F4: the stop says so; accept, reject or defer each row |
| 7.2, 7.3 Expert question with raw markdown | Yes — the word "expert" set it off on a Critique stage | No | F4: not raised on a check stage; rendered when it is |
| 7.4–7.6 Repairs and the loop | Yes (R3) | No | F2: repairs are verified and labelled; one stage repaired more than 3 times stops, worded as a loop |
| 8 "One page" unverified | Yes | No | F3: listed as *not verified* in the finish message |
| 8 "Applied from the stage check…" | It is the version note, shown in italics above the text, not in the saved deliverable | Wording | F4: shown as a note chip |
| 8 Over-literal review | Yes | No | F4: general advice is not a finding; invented specifics are |

## 3. What changed

| PR | Phase | What it does |
|---|---|---|
| #216 | F1 | Change it, a restore and a hand edit offer to update the facts they change (dates, weekdays, times, amounts, length limits — matched in code). Go's revise and repair refuse to save a revision that puts a stale fact's value back over the user's own latest version, and ask which is right. |
| #217 | F2 | The chapters are read fresh before a stage after Drafting is generated. Repairs are verified and labelled, and a repeated repair stops as a loop. No auto-draft while Go is paused. |
| #218 | F3 | Met with stages left is "not finished", with what is left. The objective record names the version, each requirement's verdict, how it was checked and what was not verified. A heading is not evidence. |
| #219 | F4 | Proposals stay proposals. Each step says what approving it does. The wording follows the stage. Critique stops explain the routine-decision limit. |
| #220 | F5 | The front door draft gets its own block with plain wording. Research routing is fixed. The layout works on a phone and an iPad. |

## 4. Retests we recommend (Sean's own sequences)

1. **Lunch invitation.** Change it to Wednesday at 1:00 p.m., under 70 words.
   - The card offers both fact updates. Apply.
   - The Facts panel says Wednesday and 70 words, "updated with your revision".
   - Press Go: the draft keeps Wednesday.
   - The finish message names the version it checked and the measured word count.
   - Restore v1: PromptMaster offers to put the facts back to Thursday.
2. **Book under "Handle them for me".**
   - Drafting, then Critique: it reads the chapters.
   - Major findings stop with the reason. Minor ones are decided and recorded.
   - An approved repair saves a new version, and Fact-check reads it.
   - Reopen the project: the same versions and stages.
3. **Workshop.**
   - Eight proposals read "Proposed by PromptMaster", and the rationale does not call them accepted.
   - On the last stage the step reads "Mark the last stage complete".
4. **Onboarding.**
   - Switch to fully remote.
   - The output begins with the plan.
   - "One page" is listed as not verified.
   - Deferred rows show as deferred, not resolved.
5. **Front door.** Ask for an email: it arrives in its own Draft block with Copy.
6. **iPad.** The Go button no longer covers text. Review rows read as cards.

## 5. Not built, with estimates

- **The workshop brief's length (18,818 characters).** A concise style for novice
  planners, offered in setup. Estimate: half a day. Proposed, not built: it changes
  what a deliverable looks like, which is Sean's call.
- **Measuring rendered page length.** "One page" depends on fonts and paper size,
  which the text alone does not fix. We disclose it as not verified (F3) rather than
  build a page renderer. Building one: about two days.
- **The tariff content in the churn chat.** We need the project's chat rows to
  explain it. About an hour once we have them.
- **Listing deferred findings in the finish message, with why they do not block.**
  This goes with a parallel fix to the same completion code (a stopped run that names
  no failed criterion). It ships in that work, so the two are not edited at once.
