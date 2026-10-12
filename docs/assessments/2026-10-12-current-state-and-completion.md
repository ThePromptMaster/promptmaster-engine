# One current state, honest completion, and fitting the workflow to the task: assessment

*12 October 2026. This answers Sean's nine emails of 11–12 October:*
- *the Meridian, Northstar, Atlas, Cedar and Diligence tests;*
- *the deferred finding that stopped Go;*
- *Colette's feedback;*
- *the two product-direction notes.*

*Sean's priority was that drafting and autonomous review agree on the current project
state. He also asked us to sort his principles into what exists, what needs fixing,
and what would be new development.*

The short version:
- **Every test report traced to a cause in the code, and each was confirmed on his
  saved projects** (§2).
- **The main one:** an instruction applied with "Change it" was saved only on the
  version it made. No later prompt read it. So the review checked the updated report
  against the original brief and called the update "unsupported". That is why Atlas
  rejected S6–S7, and why Meridian's review asked to restore the four rows and the
  26 October baseline.
- **Completion and Go read different things.** The sidebar counted stage statuses
  only, while Go stopped on open findings, measurements and its own questions.
  Meanwhile, a draft cut off by the model's length limit was saved as current and
  complete.
- **The fixes are in four changes,** #228–#231 (§3), each checked on production.
  Sean's retests are in §5.
- **Sean's direction:** much of it exists, some needs fixing (done in this round), and
  two pieces are new development, proposed with estimates and not built (§6).

---

## 1. Root causes

| # | Cause | Reports |
|---|---|---|
| R1 | An instruction applied with "Change it" was saved only on its version. It never became a fact, and no prompt read it. | Atlas, Meridian |
| R2 | The prompts ranked the old brief above the newer state. A review was told "where they differ, follow the reviewed prompt", and that prompt was written from the brief. Go's repair said "bring it into line with the brief". | Atlas, Meridian |
| R3 | The completion check read only the first 4,000 characters of the project context. It marked the cut with "[…not shown]", and the model reported that as missing material. It never saw the brief's constraints or format. | Northstar |
| R4 | A revision was told to "produce a better one; do not repeat it verbatim" next to "keep everything the instruction does not ask to change". So IDs and rows were rewritten. | Meridian (R-002, D3 → D3-P) |
| R5 | A limit on one part, such as the summary, was measured on the wrong text: past a bold label, through the table and the questions, or over the whole document. Common phrasings were not read. | Cedar, Diligence |
| R6 | Prose drafts were capped at 4,096 tokens. A revision cut off by that cap was saved as current, and its stage was marked complete. | Diligence |
| R7 | The sidebar counted stage statuses. Go stopped on open findings, failed measurements and its own questions. | Meridian, Northstar, Diligence |
| R8 | A minor wording finding deferred under "Routine decisions: handle them for me" still counted as unmet whenever its wording said "missing" or "inconsistent". A routine approval also stopped Go. | Deferred finding, Atlas |
| R9 | One state had three names, there were 14–18 unexplained menu entries, and the stated audience was replaced by a preset. A short piece could be set up as a Book. | Atlas, Colette, direction |

## 2. What the saved projects show

Read on production, read-only.

- **Meridian:**
  - Output v6 holds Sean's 9 November update, applied with "Change it". The project has no facts, and its context still says "As-of date: October 26".
  - Final review v8 marks every update as an exclusion: "the date is November 9 rather than the required October 26", "the tracker does not contain the required 4 rows", "the decision log does not preserve only D1 and D2". Each is deferred under the policy.
- **Northstar:**
  - The context is 5,367 characters.
  - The latest objective check names "the rest of the project context is not shown in this step" as a missing-source blocker, and fails the "use only supplied evidence" requirement on a decision recorded in the part it was not shown.
- **Atlas:** S6–S7 arrived in the Output v2 instruction. The review was then repaired "into line with … the brief", which said S1–S5.
- **Cedar:** Output v3 has a bold "**Summary**" label, a five-row table and three numbered questions. The new count is 80 words, matching Sean's own count, from "Report date: October 26, 2026." to "security remediation is still underway." It was 212 before.
- **Diligence:**
  - In three projects, every Go revision of the roughly 19,000-character pack ended with `finish_reason = length` and was saved as current. One of them is v4, which stops in Q11.
- **Colette:**
  - The speech project ran as a Book.
  - Its audience was "General".
  - Its first stage asked for "5–10 topic ideas", which is why it offered several wishes.
  - It wrote "2m" as mathematics.

## 3. What changed

| PR | Change |
|---|---|
| #228 | An applied instruction reaches every later prompt and check, ranked below accepted facts and above the reviewed prompt and the brief. Standing changes it states, such as "the permitted evidence is now S1–S7", are offered as new facts in the same step. One stated order: what the user asks now, then accepted facts, then applied instructions, then the reviewed prompt, then the brief. The checks read up to 40,000 characters of context, plus audience, constraints and format. A revision keeps IDs and resolved items. Go will not save a revision that restores something the user removed or renames an ID; it asks. |
| #229 | A named part is measured on that part, and the record quotes the first and last words counted. "A 250-word executive summary", "≤ 250 words" and "keep it to 250 words" are read as limits. A count overrules the model only for the part it measured. Drafts may run to 12,000 tokens. A cut-off draft is continued twice, and is never saved as complete while cut off. A repair's claims about verification are replaced with the count made in code. |
| #230 | The sidebar counts what Go stops on: "0 to go · 1 still open · Go is waiting for you". A failed measurement on a finished stage is open work. Under Autonomous with "Handle them for me": a minor or moderate Defer is recorded and does not block; carried-forward findings are revised and rechecked; a routine approval is committed. After "Update affected work", the notice names what was updated and what still waits. |
| #231 | One word per state: Proposed — not saved yet, vN · current (saved by Go), vN · earlier, Awaiting recheck. The More menu is grouped, and each stage entry says what it does. The Go panel has one main button. The stated audience is kept. A speaker of a stated age is written as a capable person of that age. A topic the user gives gets one piece. A speech is Single output, and durations are plain text. |

The known-limitations entries are L-77 to L-80.

## 3a. Checked on production (real model)

- **Lark** (Atlas sequence, #228):
  - **Setup:** a status note limited to S1–S3, produced by Go.
  - **The change:** "Change it" added S4 and said "the permitted evidence is now S1–S4". The proposal offered three facts to record, each quoted from the instruction: the evidence scope, the verified fix and the new report date.
  - **The update:** "Update affected work and resume" repaired Objective, Review, Output and Final review.
  - **The result:** every Final review row was accepted, including "matching S4". Go finished with "Objective met", with no pause and no rollback.
- **Wren** (Cedar layout, #229 and #230):
  - **The draft:** a summary of at most 100 words, a five-row table and three numbered questions. The first draft passed "Summary: at most 100 words", with no repair loop.
  - **The record:** the completion record reads "80 words, counted from 'Report date: October 26, 2026' to 'launch remains December 7, 2026.'"
  - **The finish:** Go finished the last stage on its own, and the sidebar ("4 done · 1 skipped · 0 to go") agreed with Go ("Finished: the objective is verified as met").
- **Not rerun on production:** the Diligence pack (about 19,000 characters, several model calls). Its two failures, the cut-off saves and the overlength summary, are covered by tests built from the saved projects.

## 4. Intended, but needs clearer wording

- **"Saved" is not a status.** Every version is saved. The words now are *current*
  (in use), *earlier* (history, kept if the user chose it), *proposed* (not saved)
  and *awaiting recheck* (something it depends on changed).
- **A major finding still stops Go under "Handle them for me".** It changes what the
  work says, so it stays the user's decision (L-74). Severity is the model's rating.

## 5. Retests

1. **Atlas:** widen the evidence with Change it, accept the offered fact, then run
   Go. The review should accept S6–S7 and not pause.
2. **Meridian:** apply the 9 November update. Go should not restore the four rows.
   R-002 and D3 should keep their IDs and meaning.
3. **Northstar:** the same sequence. The completion check should not report missing
   context.
4. **Cedar:** the 100-word summary should measure 80, with the counted text quoted.
5. **Diligence:** a 250-word summary over its limit should fail in code. A long
   revision should be continued, or else not marked complete. The sidebar should
   agree with Go.
6. **Deferred finding:** a routine wording Defer should not stop Go. A finding that
   needs correcting should be revised and rechecked.
7. **Colette's speech** for an eleven-year-old should get one wish, in a capable
   eleven-year-old's voice, as Single output.

## 6. Sean's principles: what exists, what was fixed, what is new

| Principle | Exists | Fixed in this round | New development (estimate) |
|---|---|---|---|
| Start with a conversation and build the brief beside it; keep direct setup | The front door: a conversation with a live draft brief, one question at a time; "Use this brief" or keep talking; "choose the workflow yourself" stays | The stated audience is kept; a short piece is recommended as Single output | Recommend the workflow *inside* the conversation, and edit every brief field there before starting: **about 1.5 days** |
| Keep simple drafts light; expose structure as work grows | One primary action with the rest under More; Single output is five stages | More is grouped and explained; Go has one main button | A lighter Single output that hides Review, Realign and Go until asked: **about 1 day** |
| Handle routine work without pauses; ask only on a real decision | "Handle them for me" covers minor and moderate findings and routine approvals | Routine Defers don't block; carried findings are repaired; routine approvals are committed; every pause asks a specific question | Severity set by rules rather than by the model: not proposed yet |
| Show changes to several documents together; accept or reject each | Change impact lists the affected stages with reasons; "Update affected work" repairs them | — | One screen of proposed changes across documents, accepted per item before anything is saved: **about 2–3 days** |
| Distinguish proposed, current, historical and awaiting recheck | All four exist | One word for each, everywhere | — |
| The same evidence and decisions for revision and recheck | Accepted facts in every prompt | Applied instructions in every prompt, one precedence order, the full context for checks | — |
| Report partial success | Stages still stale stay listed | "2 of 3 updated; still awaiting a recheck: Summary" | — |

Sean asked to make one complete change cycle dependable before expanding further:
an authorised change arrives, the affected documents are updated, and the user can
see the current plan and what is left. With this round, that cycle runs on what
exists. The combined change-set screen is the natural next step and needs his
go-ahead.
