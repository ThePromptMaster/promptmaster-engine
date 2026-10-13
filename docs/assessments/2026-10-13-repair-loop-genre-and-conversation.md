# The repair loop, honest reporting, checking that fits the work, and a simpler way to continue: assessment

*13 October 2026. This answers Sean's six emails of 12–13 October:*
- *Go on a reopened stage;*
- *the consolidated screenplay test and regression list;*
- *the main project conversation;*
- *the autonomous screenshot;*
- *understanding the request;*
- *simplifying revisions.*

*He asked for four things first: the repair and recheck loop, accurate execution reporting,
checking that fits the genre, and a simple path to continue a project. He asked for the
earlier issues to be regression-checked after that. Emails 3, 5 and 6 asked for an
assessment before any new scope.*

The short version:
- **Both of his live examples traced to specific causes in code**, confirmed on his saved
  projects (§2).
  - **The screenplay's repeated repairs were a loop.** Applying Continuity's findings
    reopened Continuity, and its recheck reopened Revision.
  - **The "98 or 159 words" question was a measuring error.** The limit was measured on
    the whole pack instead of the executive update. Go then wrote its own note into the
    document, and read that note back as a second draft.
- **The fixes are in six changes, #234–#239, each live and checked on production** (§3).
- **Of the earlier issues**, six were already fixed and five are fixed now. Three are
  partly addressed, and the gaps are named in §5.
- **On the main project conversation, reading the request, and simpler revisions**, §6
  says what exists, what this round changed, and what would be new work, with estimates.

---

## 1. Root causes

| # | Cause | Emails |
|---|---|---|
| R1 | Revision and Editing save a copy of the manuscript before rewriting it. That copy reopened Continuity, whose findings Revision was applying. Continuity's recheck then reopened Revision, and so on. | 2 #2, #5 |
| R2 | Go's guard against repeating itself looked at the stage the run stood on, not the stage being repaired. Some reopenings had no time recorded, so their repairs were never counted. After a "reconsider", the same repair was forced again. The stop said only "give it different direction". | 2 #2, 6 |
| R3 | The execution record mixed outcomes. A failed step was labelled "Draft written". "Could not continue · step done" put the run's status beside the step's. Saved, refused and rechecked were not kept apart. | 2 #3 |
| R4 | A repair of a findings table was not told which rows were decided. When it dropped them, the whole repair was refused, and the next one did the same. | 2 #4 |
| R5 | "Executive update capped at 120 words" was read as a limit on the whole pack, so the 98-word update measured 150–159 words. | 4, earlier "wrong scope" |
| R6 | Go's repair saved its "What changed … Measured in code: 159 words" note inside the document, and the check read it back as a 159-word draft. | 4 |
| R7 | Go's panel appears only on the project's current stage, and a reopened earlier stage was not something Go would pick up. | 1 |
| R8 | The Book workflow's words — book, chapter, manuscript — went to the page and to the model whatever form the brief named. | 2 #1 |
| R9 | The fact-check prompt had no rule for fiction. "No source found" looked like a decision but was not one, there was no "Fiction" status, and unresolved story alternatives came back as claims. | 2 #8–#10 |
| R10 | Go always used the project's mode. A stage's recommended mode only changed things if the user picked it. | 2 #7, 5 |
| R11 | The authorization said "each further window is your click" next to a dropdown authorising windows in advance. It also said "cannot finish the project" without saying what that meant. | 2 #12 |

## 2. What the saved projects show

Read on production, read-only.

- **Screenplay** (`0df2e5a6`):
  - Drafting reached v7 and Continuity v8 within one run.
  - Each Drafting version was the copy Revision saved before rewriting. Each one reopened Continuity, and each Continuity repair reopened Revision.
  - Two Continuity repairs were refused for dropping two decided rows.
  - New findings from the repairs were never decided, so the run ended with "Continuity 4 / Critique 3 findings not decided".
- **Status pack** (`60294547`, the screenshot):
  - Every version's executive update is about 98 words.
  - The measured line read "The deliverable: at most 120 words — 159 words". v6 begins with Go's note, and the evaluation quoted the artifact itself saying "159 words".

## 3. What changed (all live, each checked on production)

| PR | Change |
|---|---|
| #234 | **The repair loop:** a copy saved for Revision or Editing reopens only the stages after it. Every reopening records why and when. A reopened draft is answered by its next version. The repeat guard keys on the stage repaired and counts written sections as saved. A repair that does not settle stops with what is unresolved and what the last attempt did, and offers *Try once more*, *Keep it as it is now* or *Open it*. Decided rows are named to the repair and put back if dropped. Under "Handle them for me", findings a repair raises are decided with it. **Reporting:** the record shows Run, This step, Saved and Checked apart, and names the stage a repair worked on. **Measuring:** "<part> capped at N words" measures that part. Go's note goes to the version's record, not the document. Go can offer one-click answers. |
| #235 | **A reopened stage offers *Apply my changes and let Go continue*:** it is completed on its new version and the work after it is rechecked, or Go finishes it with the user's changes kept, then carries on. **Authorization:** "Go can complete every stage and check the objective. Finishing the project — the final 'Finish project' — is always your click." The windows line follows the dropdown. **Revision card:** a one-line *What changed*, *Adjust*, the saved text checked against what can be measured, and under "Handle them for me" a change that states no new fact is applied without a click. |
| #236 | **The form of the work:** "Book workflow · Screenplay", with stage words in the form's terms, and every prompt told the form and how it is written. **Fiction in the fact-check:** invented story material, continuity, setting and real-world claims are sorted. "Fiction — not an external claim" is a status, and "No source found yet — your decision" says it is a search result. **Each stage in its own mode** (Critique as Cold Critic), with "Use my mode on every stage" to override it. |
| #237 | **Regression rules** in every prompt: no claims that storage is unsupported; an owner only when the material names one; removed scope is not open work; a finished pack is not a finished project; a later wider instruction is followed. A cut check is not read as missing work. |

| #238 | **Fiction in the fact-check, enforced in code:** every claim row has a kind (real world, historical setting, invented). An invented row is settled as Fiction and never looked up. An answer that says "Go back to <stage>" is carried out as the user's own return (#237). |

| #239 | **Fiction fact-check, sharpened:** anything that matters only because of who did or said it in the story is invented. A setting row states the general period fact. The reader, export and finish screens say "screenplay" on a screenplay. |

The known-limitations entries are L-81 to L-84.

### Checked on production
- **Status pack, rebuilt** (#234):
  - The objective record reads "Executive update: at most 120 words — 53 words, counted from 'As of November 2, 2026,' to 'this remains unverified by Finance.'"
  - Go ran to "objective met" with no false limit failure, no loop and no question.
- **Reopen and continue** (#235):
  - Output was reopened and changed in the side chat. The conflict with "use only the stated facts" was flagged.
  - The card showed What changed and Adjust. Applying listed "62 words; 3 sections" as checked on the saved text.
  - *Apply my changes and let Go continue* rechecked Final review once, and the run ended "objective met on Output v2".
- **Screenplay, rebuilt** (#236 and #238): a new project with "a feature-length screenplay about the French Revolution … fiction loosely inspired by history".
  - **What it showed:**
    - "Book workflow · Screenplay" in the sidebar, with the stage words in screenplay terms.
    - The draft in screenplay format: scene headings, action, and names above dialogue.
    - Each stage in its own mode: Clarity, Analyst, Critic, Analyst, Architect, and Cold Critic for Continuity and Critique.
  - **Routine and major findings:** under "Handle them for me", the moderate findings were decided by Go. The six major ones were left, each row saying "Left for you: major — it changes what the work says".
  - **Revision:** it ran once, and Continuity was **not** reopened. Sean's run reopened it six times.
  - **Critique** asked one editorial question with two buttons: go back to Revision, or continue to Fact-check.
  - **Fact-check, first pass:** the prompt carried the fiction rule, but the model still listed invented material (a made-up memorandum, a search, a character's line) as claims.
    - #238 makes this code: every claim row has a kind, and an invented one is settled as Fiction and never looked up.
    - #239 says that story lines are invented, and that a setting row states the period fact.
  - **Fact-check, final table:** 11 rows state facts a source could confirm, such as "District committees in revolutionary Paris issue warrants and conduct house searches". The invented household is Fiction, settled without a click. No row asks for a source for an invented scene.
  - **Two things this pass found and fixed:**
    - After the user answered "Go back to Revision", Go asked a second time whether to go back. An answer that names going back is now carried out as the user's own return (#237).
    - A decision recorded from an answer can still reopen Continuity and Revision once more. Go repairs each once and stops. It stays bounded (at most two repairs per stage); it is named in L-81.

## 4. Intended, and now said plainly

| Stop | Why it is yours |
|---|---|
| Finishing the project | "Finish project" is always the user's click. Go completes stages and checks the objective. |
| Major or unrated findings under "Handle them for me" | They change what the work says. Each row now says "Left for you: major — it changes what the work says". |
| A change that states a new fact | Recording a fact is the user's decision, so it waits for the click even under "Handle them for me". |
| A repair that did not settle after two tries | The stop says what is unresolved and what the last attempt did, with three buttons. |

## 5. The earlier issues, regression-checked

| Issue | Status |
|---|---|
| Word limit measured on the wrong part (Harbor) | **Fixed** (#234). Verified on production. |
| Old instructions overriding newer authorized changes (Meridian) | Fixed earlier (#228): applied instructions rank above the brief. |
| Issue IDs reused | **Partly.** A removed ID coming back, or a renamed ID, is caught in code. An ID kept but reused for something else is held only by the prompt rule. |
| Proposal identity changed on approval | Fixed earlier: the decision keeps the proposal's ID (`recommendation_id`). |
| Unsupported owner assignments | **Fixed** (#237, prompt rule): "Proposed owner" or "Owner: to confirm" unless the material names the owner. |
| Removed scope mixed into open work | **Fixed** (#237, prompt rule). Open work in code does not yet filter by subject. |
| Pack completion confused with project completion | **Fixed** (#237): the prompts and the objective check. |
| Truncated quoted requirement treated as a blocker | **Fixed** (#228, #237): checks read the whole context, and every cut is marked and said not to be missing work. |
| A later instruction conflicting with an earlier edit scope | **Fixed:** the conflict prompt recommends "my new instruction takes priority", and the prompts follow it (#237). |
| Storage claims | **Fixed** (#237, prompt rule). |
| No Go path from a reopened stage | **Fixed** (#235). Verified on production. |
| Acceptance criteria too weak | **Partly.** Measurable requirements are checked on the right part; others are judged by the model. |
| Draft handoff between stages | Fixed earlier (#212). The screenplay test reads the manuscript at every review stage. |
| Contradictory readiness | **Partly.** The bar says "Ready to move on · N still open" with the items named. |
| Repeated reasons | **Partly.** A reason is filled from the row's own text where it has one. There is no "same reason for all" yet. |
| Unavailable buttons | Fixed earlier: Go names only buttons the page lists. |
| Side-chat context contamination | Fixed earlier (#227). |
| Verification status mismatch | Fixed earlier: a status the row contradicts is flagged. |
| Attachments missing, unread or unnecessary | **Partly.** These are separated for data files; attached documents are only "facts not yet recorded". |

Found while testing: on New project, the "unfinished setup" banner can appear after typing has begun, and clears the goal box. It is small, and is next on the list.

## 6. The main conversation, reading the request, simpler revisions

### Email 3 — one main project conversation
**Exists:**
- The front-door conversation, which builds the brief.
- A side chat per stage, with *Ask* and *Change it*, and buttons on replies.
- The Go panel with its questions, now with one-click answers.
- The sidebar's status ("Go is waiting for you").

**What it would take:** one project thread, in place of a thread per stage, where:
- Go's questions, its stops (with their buttons) and its finish are posted as cards;
- an instruction typed there becomes a change, an answer or "carry on";
- a status chip shows working, blocked, needs you or finished.

Stages, versions and settings stay one click away. **About 3–4 days**, most of it moving existing cards into one feed.

### Email 5 — understanding the request and choosing the approach
| Part | Today | Where |
|---|---|---|
| Reading "long", "short" and "a lot" in context | Model instruction (setup suggester, stage prompts) | `setup_suggester.py`, `stage.py` |
| Measuring a stated limit | Code | `measurable.ts` |
| Choosing the approach per stage | Code, new this round: each stage's recommended mode | `stage-mode.ts` |
| Choosing the approach per request ("look at this from a few angles") | Not built | — |
| Explicit, approved, inferred and suggested requirements | Partly: facts record who accepted them; a suggested constraint is labelled "Suggested by PromptMaster, not something you said" at setup | `project_facts`, setup page |
| Applying a requirement to the right part | Code for measurable limits | `measurable.ts` |
| Thinking kept apart from permission | Code: the commit check, the conflict check and the routine-decision policy | `commit-check.ts`, `policy.ts` |

**Needed:**
- A requirement-origin field (explicit / approved / inferred / suggested) on facts, so an assumption never silently becomes a constraint and suggested targets are not enforced until confirmed: **about 1.5 days, with a migration**.
- Choosing the approach for a request typed in the chat: **about 1.5 days**.

### Email 6 — simpler revisions
**This round:**
- One focused revision of the current draft.
- A one-line *What changed*, with *Apply* and *Adjust*.
- The saved text checked against what can be measured.
- Under "Handle them for me", applied without a click unless it states a new fact.
- A failed repair says what is wrong and offers a concrete next step, instead of repeating.

**What remains:** a single review of a change that touches several documents, with accept or reject per item. This was estimated on 12 Oct at **about 2–3 days**.
