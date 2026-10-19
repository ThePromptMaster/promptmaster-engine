# Section limits, authority read correctly, changes followed through, and what the workflow protects: assessment

*19 October 2026. This answers Sean's eleven emails of 17–18 October:*
- *"copy" or "copied" (email 1);*
- *what measurable protection the workflow adds (2);*
- *FIELDGUIDE blocked by a word limit (3);*
- *the search-screening workflow (4);*
- *the Theory of Everything repair loop (5);*
- *picking colours (6);*
- *a beta tester's "too overwhelming" feedback (7);*
- *the Summit comparison (8);*
- *the Ridgeway CEO authorization (9);*
- *tracing one update through the system (10);*
- *the Method screenshot (11).*

The short version:
- **Every blocker traced to a cause in code**, confirmed against his saved projects (§1). None of them was the model getting the work wrong:
  - FIELDGUIDE was blocked by our parser, not by the draft;
  - Theory of Everything was blocked by our row guard, not by lost content;
  - the Ridgeway authorization was misread by a keyword rule, not by the model.
- **The fixes are #296–#305 and #311, live on production since 19 October.** FIELDGUIDE was replayed on a copy in Chrome, which found one more fault (#311).
- **#306–#310 are open**: what Go changed, the copy note, colours, and a simpler start. They are not yet live.
- **His paused projects were not modified.** How to resume each is in the reply.
- **Email 2 (what the workflow protects):** §2 lists what code enforces and what the model judges. §4 proposes the smallest controlled test. An honest answer today: the code-enforced checks catch a specific, countable set of failures. The last same-model run (17 Oct, KESTREL) did not show less user effort.
- **Email 4 (search screening):** a screening prompt works today, but the workflow he describes does not. Projects persist documents, facts and history, not structured candidate records (§5).

---

## 1. What the emails found

| # | What Sean saw | Cause | Fix |
|---|---|---|---|
| F1 | FIELDGUIDE: the pilot plan's 500-word limit applied to the whole package, "2,254 vs 500" (email 3) | `parseRequirements` (`measurable.ts`) knew only a few section nouns. "Curriculum (≤900)" became a second `words:memo` and was dropped. "Pilot evaluation plan (≤500)" got no section, which means the whole deliverable. | #297 |
| F2 | The clarification "there is no 500-word limit on the complete package" did not lift the check | The same parser read the fact as "500-word limit" and ignored "no", so the clarification *created* the limit it denied. | #297: a negated limit now retires the matching one |
| F3 | The compressed curriculum lost its timed activities | A length repair skipped the preservation check by design ("what went was what was asked"). | #298: headings and timings are checked after a length repair; a repair that drops them is not saved, and Go asks |
| F4 | Output offered "Have Go fix Output and check again" while Summary offered "Resume Go" | Two components read the same pause separately. The Summary notice ignored Go's own needs. | #301 |
| F5 | The practice candidate's next interview was listed under "Proposed, not done" | The objective check listed every next step in the text, including those inside the fictional exercise. | #300: a prompt rule plus a code filter on sample, fictional and practice sections |
| F6 | Theory of Everything: "dropped two protected rows", so the table could not be saved (email 5) | The guard treated Go's own provenance label ("candidate source") as the user's decision. It also matched rows by id only, so a list → table restructure looked like deletion. | #296 |
| F7 | We could not tell whether rows `i7` and `i8` were really lost | A refused revision was never stored. | #296 stores it from now on; this one cannot be recovered (L-91) |
| F8 | "Ready to move on" while Go's check blocked moving on | The bar read the exit criteria; Go read the evaluator's completeness verdict. | #299: one verdict (`check-verdict.ts`) for both |
| F9 | The evaluator called references to later stages unsupported | The evaluator was never told the later stages. It also saw table rows as raw JSON and asked for "a table". | #299 |
| F10 | Ridgeway: "The CEO authorizes … 75 hours" listed as a request (email 9) | A keyword rule (`fact_filters.py`) marked any sentence containing "proposed" as a request. The sentence said "supersedes the proposed 100 hours". The model was never asked. | #302 |
| F11 | The $27M correction did not mark $30M as superseded (email 10) | $30M was only in the brief, so there was no fact to supersede. The leftover-value check therefore had nothing to look for. | #303 |
| F12 | Summit: "EBITDA deterioration despite higher revenue" survived the revenue correction (email 8) | Repairs checked only for the literal old figure. A conclusion drawn from it contains no figure. | #305 |
| F13 | A positive "No change required" finding carried forward as unmet | The unmet-wording check ran over every field and matched "missing" in "missing-data register". | #304 |
| F14 | Completed ticks beside unresolved findings | The rail showed only exit criteria. | #304: "done · N open" |
| F15 | "Approver unknown" while quoting the board's authorization | The approver check knew only personal names. | #304: roles count as approvers |
| F16 | "I cannot see what the one applied finding changed" (email 11) | The apply step reported only "Applied 1 finding", and the planner never saw the diff. Go also re-checked and applied findings after "approve it as it stands". | #306 (open) |
| F17 | "Copied" after starting a new version (email 1) | The Finished page's clipboard note did not say which version was copied. We could not find another "copied" label, so we have asked for a screenshot. | #307 (open) |
| F18 | Picking colours (email 6) | Colours were fixed. | #308 (open): per-browser choice of accent, starting colour and version palette |
| F19 | "Overwhelming"; unclear whether PromptMaster does the task; Instagram videos (email 7) | Setup showed every field at once, and Guide asked up to six questions. Single output's Review stage read like a prompt to paste elsewhere. Nothing said links cannot be opened. | #309, #310 (open) |
| F20 | Found on our replay: going back to Output "to apply the accepted fixes" could not see them | A return to an earlier stage carried only the instruction text, not the review rows. | #311 |

## 2. What is enforced in code, and what the model judges (email 2)

| Protection | Enforced in code | Judged by the model |
|---|---|---|
| Facts are the record | Append-only with `supersedes` and a database trigger (`project_facts`). Every prompt gets the current facts and what each replaces (`project_context.context_block`). `origin` records whether the user said it or PromptMaster assumed it (#303). | Which statements in an instruction are new facts (`revision_facts.py`). |
| Requests and approvals | An approval verb by a named authority ("authorizes", "approves", "signs off") is an approval; "has not approved" and "asks the board to approve" are not (`fact_filters.py`, #302). The model's label can never turn a line into an approval. | The label on lines with neither kind of verb. |
| Old values | A replaced value still stated as current fails the repair (`leftoverValues`, `fact-values.ts`). A brief-only figure counts once a fact says what it replaces (#303). | — |
| Dependent conclusions | A flagged sentence still present word for word fails the repair (#305). | Which sentences no longer follow (`dependent_claims.py`, one call). |
| Measured limits | Word, item and similar limits are counted, per section (`measurable.ts`, #297). A length repair may not drop headings or timings (#298). | — |
| Decided rows | A row the user or the policy decided cannot be dropped or have its decision changed (`commit-check.ts`). A restructure that keeps the text passes (#296). | — |
| Overwrites | A revision made from an older version is refused and stored (`revision_refused`, #296). | — |
| Readiness | One verdict drives Go's gate, the bar and the next step (`check-verdict.ts`, #299). Exit criteria are pure functions. | Completeness, alignment and drift (`stage_evaluation.py`). |
| Approvers and figures | A named approver, person or role, needs a source in the record (`approver-support.ts`). A figure not on the record, and not one step from it, is flagged (`figure-support.ts`). | How history is worded. |
| Conflicts | A conflict with an approval asks the user. Overriding an approval the instruction does not record asks twice (`precedence.ts`). | Whether there is a conflict (`conflicts.py`). |
| Stage state | The model cannot move stage state: `project_stage_events.actor` has no `'model'`. Versions are append-only. | — |
| Completion | Finishing is the user's click. Measured limits are counted, not judged. | Whether each part of the objective is met (`objective_assessment.py`). |

**"Preserve the facts and continue without asking" (email 2's fourth question).**
- **What happens today: it asks.** When an instruction conflicts with an accepted fact, the conflict check asks which takes priority, in "Change it" and in Go (`askWhichTakesPriority`, `perform.ts`). That is true even with routine decisions set to "Handle them for me". The recommended answer keeps the record, but the user still has to click it. That is the extra confirmation step Sean saw.
- **What should change:** a request that conflicts with an accepted fact, and carries no authority, can be kept out without asking. The recorded fact stands, and the deliverable says the request was not adopted. A change in authority or scope, such as overriding an approval or widening scope, should still ask, as Sean wants.
- **Status:** not built this round (L-93). The request/approval split in #302 is the piece that makes it safe to build.
- **Why it is not trivial:** whether there is a conflict at all is model-judged (`conflicts.py`). A reworded restatement of a fact can be raised as a conflict, and we have not measured how often that happens.

## 3. One update, traced (Ridgeway, email 10)

The update had four parts:
- the CFO corrects revenue ($30M → $27M) and EBITDA ($4.2M → $3.6M);
- the CEO authorizes 75 hours;
- no work has started;
- the COO asks purchasing to order the $900,000 system.

| Step | Input | Output | Code | Model | Before 19 Oct | Now |
|---|---|---|---|---|---|---|
| 1. Intake: "Change it" reads the instruction | Instruction, current facts, brief | Proposed facts, each labelled fact, request or approval | Filters for duplicates and filler, plus the approval and request verbs | Which statements are facts, and labels where no verb decides | "Proposed" made the CEO line a request | The CEO line is an approval ("Approved by the CEO"). The COO line is a request (#302). |
| 2. Recording | The user ticks the proposed facts | `project_facts` rows | Append-only; `supersedes` when the fact replaces a fact; `origin` | — | `$27M` saved with `supersedes = null` and nothing replaced | The fact still has no `supersedes` (there is no $30M fact), but its own words name what it replaces: "superseding the earlier $30 million" (#303). |
| 3. Drafting and revision | Current facts with "replaces …", the brief, the instruction | A new version | — | The rewrite | The brief still said $30M; only the prompt said the facts win | The same prompt rule, plus step 4 |
| 4. Repair check | The new version and the current facts | Pass, or fail with what is still stated | `leftoverValues` on "$30 million"; a flagged sentence still present fails | Which conclusions no longer follow | Nothing to check | $30M stated as current fails. "Despite higher revenue" is flagged and must change (#305). |
| 5. Stage check and final review | The version, current facts, the later stages | Findings | Approver check (person or role); figure check | Alignment, completeness; the final review is told to read every conclusion against the record | Board quoted while the approver was "unknown" | Roles count, and "approver unknown" for a recorded authorization is flagged (#304) |
| 6. Objective check | The deliverable, the facts, the failed checks | Met, partly or not met, with blockers | Measured limits; requests set aside | Each part of the objective | — | Unchanged in this round, apart from #300 and #311 |

**Setup expansion (email 10's third question).**
- **Before:** everything the front door drafted was saved as the user's own (`accepted_by = user`). Nothing told the user's words apart from what PromptMaster inferred.
- **Now (#303):** each fact carries `origin`:
  - `user_stated` — the user said it;
  - `model_assumed` — PromptMaster inferred it, because figures or most words in it were not in what the user wrote;
  - `policy` — Go accepted it under the routine-decision policy.

  The setup list and the facts panel label assumed items, and every prompt says which facts were assumed.
- **Limit:** "said" is decided by matching words and figures, so a close paraphrase of the user's words counts as stated (L-92).

**The acceptance test Sean proposed** in email 8 was: change a source fact, update every dependent calculation and conclusion, and check the finished report for contradictions. Steps 3–5 now do that.
- **Code-enforced:** calculations and literal values.
- **Model-judged, with code confirming the change was made:** conclusions.

We recommend rerunning Ridgeway on a fresh copy against this answer key:
- $27M and $3.6M current;
- revenue down on the previous quarter, and no "despite higher revenue";
- the CEO authorization recorded as an approval with no date;
- the COO order still a request with no board approval;
- no approver shown as unknown where the record names one.

## 4. The smallest controlled test (email 2)

**Question:** with the same model and settings, does the workflow lead to fewer consequential errors, less drift and less correction work than a plain chat?

**Design:**
- **Scenario:** one scripted, Ridgeway-sized project with an answer key, and five successive updates:
  - a factual correction that changes a conclusion's direction;
  - an authorization by someone with authority;
  - a request with no authority;
  - pressure to exceed the approved scope;
  - a restatement of an accepted fact in new words.
- **Arm A, PromptMaster:**
  - Single output, Claude Opus 5.5, Go autonomous with routine decisions handled;
  - each update given through "Change it".
- **Arm B, plain chat:** the same model through OpenRouter, no system prompt, the same messages in one conversation.
- **Runs:** each arm three times, because one run per arm shows only whether a difference is worth measuring.

**Measures:**

| Measure | How it is counted |
|---|---|
| Consequential errors | Answer-key items wrong in the final package (stale figure, stale conclusion, request shown as approved, invented approver or date). Scored by a person. |
| Drift | Items that were right after one update and wrong after a later one. Scored by a person. |
| Correction effort | User messages and clicks beyond the five updates. Arm A: user events in `workflow_events` and answers in `agent_steps`. Arm B: extra messages. |
| Caught before delivery | Arm A only. Repairs that failed a code check and were redone or refused, from these logs: `revision_refused` events; `agent_steps` with a failed repair; findings applied before the deliverable was finished. Each is counted only if the final package is right on that item. |
| Unnecessary stops | Arm A: Go questions whose answer was already on record. |
| Cost and time | `model_usage.cost_usd` and `agent_runs` timestamps against chat token cost. |

**What the logs can already show**, without a new test:
- every refused revision since 19 October, with its content;
- every failed repair step and its reason;
- every objective check with its unmet items;
- every return to an earlier stage (`stage_returned`).

"Caught and repaired before delivery" therefore exists in the record, but only for checks code makes. A model-judged miss that nobody caught does not appear anywhere.

**Estimate:** about one day to script and run, plus about two hours of scoring.

**What we expect:**
- **Arm A:** fewer stale figures and invented approvals.
- **Both arms:** stale conclusions are now checked in A, but by the model.
- **Effort and cost:** as of 17 October, Arm A's effort and cost were higher. That is the number the test has to move.

## 5. Search screening (email 4)

**What works today:**
- **Requirements:** a project holds the role specification and screening criteria as facts, with attachments in `project_files`. Every prompt receives them, so they do not need restating.
- **Screening:** pasting a batch of profiles into the side chat gives an evaluation against those criteria.
- **Reuse:** a custom workflow, for example "brief → criteria → screen → shortlist", can be saved and reused across searches. Each search is its own project, so searches stay separate.

**What it does not do:**
- **No candidate records:** projects persist documents, facts and conversation. There is no candidate or profile table. A list stage stores its rows as JSON inside a version, has fixed columns (claim, source, confidence), and holds at most 12 items.
- **The rest of the workflow is missing:**
  - no duplicate detection across batches;
  - no call list or contact status;
  - no re-scoring of earlier rows when criteria change, while keeping the user's decisions and contact history.

**So a screening prompt works; the screening workflow is not implemented.**

| Need | Configuration | New development |
|---|---|---|
| Spec and criteria attached; batches without restating | Yes: facts, files, side chat | — |
| Green / yellow / red with evidence; unknowns separate from negatives | A prompt rule in a custom stage | A structured result per profile, so this is checked rather than formatted |
| Profiles and results saved; duplicates found | — | A `candidates` table under RLS (one row per profile per search), and duplicate matching on name and employer |
| Call list, contact status, notes | — | Status and notes columns, and a list view |
| Criteria change → affected evaluations flagged, decisions kept | Facts supersede today | Re-scoring the rows a changed criterion affects, never touching the user's status or notes (the same rule as decided rows) |
| Separate searches, shared templates | Yes: projects and custom workflows | — |

**The smallest end-to-end test:**
- **Data:** 30 fictional profiles in three batches, including two duplicates. One criterion changes after batch 2.
- **What it has to show:** saved records, duplicates flagged, a call list with status, and the right earlier rows re-flagged after the change, with decisions intact.
- **Estimate:** the table, the screening stage and the list view take about 4–6 days, plus 1 day for the test.

**The same-model comparison** uses the design in §4, with the screening answer key:
- criteria adherence;
- unsupported conclusions;
- missed updates after the criterion change;
- duplicates missed;
- user corrections.

**Not authorized:** this is a feasibility answer, not a scope change. Nothing touching real search data, shared folders or a CRM is proposed.

---

Register: L-91 to L-95 in `docs/known-limitations.md`.
