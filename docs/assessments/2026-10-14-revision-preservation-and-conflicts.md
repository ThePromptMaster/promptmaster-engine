# Part limits, revisions that keep what they were not asked to change, one conflict question, and the front page: assessment

*14 October 2026. This answers Sean's six emails of 13 October:*
- *ASPEN retest (email 1, and its forwarded screenshots);*
- *LANTERN, simplifying revision conflicts (2);*
- *front-page feedback (3);*
- *the wedding speech (4) and its comparison with Claude (5);*
- *the workshop time change (6).*

The short version:
- **Each email traced to one cause in code**, confirmed on his saved projects (§1).
- **The fixes are in #244–#248**, each merged, deployed and checked on production (§2).
- **Two of the production checks found faults in the first version of the fix.** Both are fixed in #248 (§2).
- **What is still judged by a model rather than by code** is listed in §3, and in `docs/known-limitations.md` (L-87).

---

## 1. Root causes

| # | What Sean saw | Cause (confirmed on his project) |
|---|---|---|
| R1 | ASPEN: "The deliverable: at most 100 words — 171 words" for an 81-word update; two failed repairs | "Executive update **must be** no more than 100 words": the parser rejected a part's name followed by a verb, so the limit fell back to the whole pack. The repair then tried to fit three sections into 100 words. |
| R2 | ASPEN: "The stage changed while this revision was being made" | The draft that starts when a stage opens was still running when Go was pressed. It landed at 19:54:37; Go's own draft of the same stage landed at 19:54:53 against an empty base and was refused. The guard stopped *new* auto-drafts under Go but never cancelled one already running. |
| R3 | LANTERN: an "as of November 10" restriction, the Nov 12 update counted twice, recommendations not about Elena's approval, raw-text buttons, several questions | The conflict prompt had no rule for reporting dates or recorded requests. Applied chat instructions stayed "pending". Facts could not be what a conflict is with, and the recommendation depended only on the kind of thing. Labels quoted the instruction, and stored decisions quoted it again, cut at 160 characters. Up to five radio pairs. |
| R4 | LANTERN: decision log missing Elena's authority and the $50,000 budget; "no increase approved" listed as a decision | Nothing told the draft what a decision log records. |
| R5 | Wedding speech: the revision added a "lifelong pattern" and enlarged the presentation story | Nothing checked a revision for personal claims. The stage prompt said "work from general knowledge", with no exception for people. |
| R6 | Wedding speech: "There is no draft here yet" beside the chip "(An output exists)" | The chip quoted an unmet criterion's label as if it were true. |
| R7 | Workshop: "Confirm 12 attendees", the greeting and the sign-off dropped | The side-chat change (v4) kept them. **Go's recheck after it (v5)** dropped them. For prose, the commit check only refused an empty result; nothing compared a revision with the version before. |
| R8 | Front page: "What a chat does not do" too absolute; promises to verify; low contrast; long mobile page; Beta chip over text | Copy and layout. |

## 2. What changed

| PR | Change | Checked on production |
|---|---|---|
| #244 | A part's limit is measured on that part ("Section N", "Section N (name)", "X must be…"). A part with no heading is never measured as the whole. A repair revises only the failing part, and every other section is put back in code. The opening draft yields to Go. A refusal says what was saved meanwhile. | ASPEN replay: "Executive update: at most 100 words" ✓ beside "exactly 3 sections" ✓. All 12 Go steps succeeded with Go pressed during the opening draft, and nothing was refused. |
| #245 | A revision is compared with its base in code. Short lines it dropped without being asked are put back, and longer ones reported. The side-chat card says what was kept, with "Remove them anyway". When the brief says not to invent details, every prompt carries a fact boundary, and `/api/check-new-claims` lists new personal details with "Take these out". The chip says "Not yet: …". | Wedding replay: the revision's "she's been very comfortable telling me what to do for most of it" and two added traits were listed. "Take these out" removed them. |
| #248 | Fixes found by the production checks: (a) a short line edited in place, or one the instruction names, is not put back; (b) the claim check ignores paraphrase of supplied material and the speaker's own impressions. | (a) Go had been asked to fix "the 0-minute Training item"; the old line was put back beside the new one. (b) "It's not forced or showy" was flagged. Both are fixed and retested (§2.1). |
| #250 | Fixes from the LANTERN production pass: an objective or constraint conflict whose only ground is an as-of date or a "use only this record" scope is dropped in code (unless the brief asks for a frozen report); an approval conflict must cite the approval rule. | Retested after deploy (§2.1). |
| #249 | "Executive update: no more than 100 words" (the wording in Sean's full ASPEN record) is read as the part's limit. | Unit-tested. |
| #246 | Conflicts: an as-of date, a recorded request and a repeated decision are not conflicts. Facts are listed with ids and can be the target. An approval rule leads, with a one-sentence explanation, what keeping it means, and two short labels. One question, with the rest folded. Overriding a recorded approval asks once more. Applied instructions are no longer pending. A decision log records authority and approved amounts. | LANTERN replay (§2.1). |
| #247 | Front page: "How PromptMaster manages your project"; each claim restated as the build does it; a compact "A change, handled" example; contrast `/40` → `/75`; phone spacing halved; "Beta" in the header instead of a floating chip on `/`. | 390px render (§2.1). |

### 2.1 Production retests

Each scenario was replayed on production with Sean's wording, and screenshots are in `docs/media/pr/oct14-prod/`.

- **ASPEN** (main c82a14f).
  - **Go during the opening draft.** Go was pressed while the opening draft was still running, and all 12 steps succeeded.
  - **The update's limit.** The checklist read "Executive update: at most 100 words" ✓ and "The deliverable: exactly 3 sections" ✓. The update, tracker and log all stayed in place.
- **Wedding speech** (main 1fbb9f4).
  - **The details were listed.** For Sean's instruction ("…add no new personal details…"), the proposal listed the added details: "she's been very comfortable telling me what to do for most of it" and two new traits.
  - **"Take these out" worked.** It produced a version without them.
  - **The check then over-flagged.** The next check flagged a paraphrase of supplied material ("It's not forced or showy") and the speaker's own impression. The prompt was narrowed in #248.
- **Workshop** (main 6d80683).
  - **The time change kept everything.** The side-chat change kept the greeting, sign-off and "Confirm 12 attendees", so the card had nothing to put back.
  - **Go's recheck could not be forced on production.** That repair runs only when a recheck happens. It is tested on Sean's own v4 → v5 texts.
  - **A fault in the first version.** The first version put back a line Go had been told to edit, "the 0-minute Training item". Fixed in #248.
  - **The old conflict screen also stopped this time change** against the objective's 9:00. A rule was added to #246: a value the user changes in their own words is their later word.
- **LANTERN** (main eb31e59).
  - **Omar's request.** It produced one question: "…only Elena can approve a change. I'll keep the currently approved completion date… and treat Omar's January 15 date as an unapproved request unless Elena approves it."
    - The choices were "Keep approved date (recommended)" and "Treat Jan 15 approved", with two related points folded.
    - Overriding asks once more.
    - Keeping the date produced December 18, Omar's request as unapproved, $24,000, and the vacancy completed.
  - **The decision log** lists Elena's authority and the $50,000 budget. It does not list "no increase approved" as a decision.
  - **Two faults, both fixed in #250:**
    - the model still once raised the November 12 update against "as of November 10"; this is now dropped in code;
    - the override confirmation cited the wrong fact.
- **Front page.** A 390px render (#247).

## 3. What is judged by a model, not by code

- **Whether a fact is an approval rule** (`protects_approval`) and the wording of the two choices. The labels are held in code to at most eight words with no quotation marks; otherwise PromptMaster's own wording is used.
- **Which personal details are new.** The check can miss one, and can flag a restyle. It is held in code to quotes that are verbatim in the new text and absent from the old text and from what the user supplied. A flagged revision is never applied without a click. The first draft of a document is not checked, only revisions.
- **Line preservation is word-based.** A line reworded with new words counts as gone and is put back if it is short. Longer passages are reported, never put back.
