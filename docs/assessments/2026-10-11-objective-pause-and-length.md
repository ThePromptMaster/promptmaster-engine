# The survey kickoff brief: Go's objective pause, the word count, and routine corrections

*11 October 2026. In reply to the client's test of a customer survey kickoff brief.*

The test brief had these requirements:
- capped at 200 words;
- exactly four sections;
- generic roles;
- no invented company details;
- labelled assumptions.

It ran under "Handle them for me".

The client asked three things:
1. Check the word-count result.
2. Explain why a routine correction became a human approval gate.
3. Make the first pause name the actual failure.

The short version:
- **The first pause, "The objective is not met yet" followed by praise for the brief, was
  a fault in how we reported a verdict, not in the brief.** The check had called the brief
  met. Our code needs that verdict backed by a sentence copied from the brief. Without one
  it downgraded the verdict but kept the model's own praising sentence as the reason. So
  no failed criterion was named, because none had failed.
- **"Exceeds 200 words" was the model's count, not ours.** The objective said "capped at
  200 words", which our measurement did not recognise. The limit was never counted in
  code, so the model's estimate stood unchallenged. The same brief on production now
  measures 131 and 151 words, and 4 sections.
- **The approval gate was a gap, not a policy.** Go shortened a measured failure
  automatically only on a stage already marked complete. The brief's stage was still
  open. Every stop then lacked a defined decision, so the panel showed a statement where
  a question belonged.
- **All three are fixed and live:** #222, #224 and #225, deployed on 11 Oct. Under
  "Handle them for me", the same brief now runs from Input to "Finished: the objective is
  verified as met" with no question.

---

## 1. The first pause

| What the user saw | What happened in the code |
|---|---|
| "The objective is not met yet:" followed by text saying the brief satisfies the requirements | The model returned *met*. Its supporting quote was not in the brief word for word (or was a heading). `objective_assessment.py` downgraded *met* to *partly* and kept the model's reason. |
| No criterion named | None had failed. The only problem was the quote. |
| No question | The stop carried no `needs`, so the panel showed the stop sentence as if it were the question. |

**Now (#222):**
- The reason is built from what failed. Measured and carried-forward checks come first,
  then each criterion found not met, as "Not met: X — basis".
- A *met* that loses only its quote is asked again, once, with the reason.
- If the quote still fails, the pause says "found nothing unmet, but could not point to a
  passage that shows it", with **Carry on** / **Stop here**. It never presents praise as a
  failure.
- The model's own sentence is kept in the record as *the check's own words*.

## 2. The word count

- **Recognising the limit.** `measurable.ts` read "under", "at most", "no more than" and
  "up to", but not "capped at". In the client's project the 200-word limit was therefore
  not a measured requirement. The objective check judged length by eye and wrote "exceeds
  200 words". We could not open the client's own project from here (production reads are
  restricted). The code path leaves no other source for that sentence.
- **What changed:**
  - "Capped at", "limited to", "200 words max", "a 200-word limit" and five other
    phrasings are now read (#224).
  - "Exactly four sections" is now measured (#222).
- **How we count.** We count the words of the text itself. Headings and a word-count note
  are left out. Until #222, lines beginning "Assumption" were left out too. That rule was
  meant for notes a model sometimes appends, and it was wrong for a brief asked to label
  its assumptions. Those lines now count.
- **The count governs.** The objective check is given the code's counts and told not to
  count again. If it still calls a measured requirement unmet, the count wins and the
  record says the model was overruled (#222).
- **The same rule fixes a second production report (#222).** A lunch invitation was
  measured against the objective's "under 120 words" after the accepted requirement had
  changed to "under 70". An accepted requirement now replaces the brief's figure.

## 3. Why the correction became an approval gate

- **Go repaired only finished stages (`needs.ts` `staleRepair`).** It repaired a measured
  failure automatically only on a stage already marked complete. The brief's Output was
  still in progress, so the over-limit count only stopped it moving on. Go then reached the
  objective check, which stopped.
- **None of the objective check's stops named a decision.**
- **After both fixes, a third gate showed on production:** with the objective met, Go
  stopped twice to ask whether to carry on to stages that had nothing unmet.

**Now:**
- **Shortening is routine work (#222).** A drafted stage that fails a measured requirement
  is revised by Go: it keeps every section, label and fact, saves a new version and
  measures again, at most twice. The step reads **Fix a measured requirement**.
- **Every stop names its decision (#222).**
  - Not met: **Have Go fix Output and check again** / **I will fix it myself**.
  - Met with stages left: **Finish Output and carry on** / **Stop here**.
  - The run account reads "Your decision is needed: 'A' or 'B'".
- **Met with stages left is routine too (#225).** Under Autonomous and "Handle them for
  me", Go finishes the stage and carries on. An approval only the user can give still
  stops.
- **No repeat checks (#225).** An unchanged version already judged met is not judged
  again. Each repeat was a model call for the same answer.
- **Deferred items are named (#222).** Deferred review rows that do not block are listed
  with the finish, each with the reason it was deferred.

## 4. Production retest (11 Oct, after deploy)

Same brief, from "What do you want to do?", run with "Let Go run this".

| | Before (client's run) | 11 Oct, #222 + #224 | 11 Oct, + #225 |
|---|---|---|---|
| Word limit | not measured; model said "exceeds 200" | measured: 131 words | measured: 151 words |
| Four sections | not measured | measured: 4 | measured: 4 |
| First objective check | "not met yet" + praise | met | met |
| Stops for the user | 2, neither naming a decision | 2, "Finish Output and carry on" / "Carry on to Summary" | none (one window pause, L-76) |
| End | — | waiting on the user | "Finished: the objective is verified as met", with the deferred row and its reason |

## 5. What remains

- **L-75:** only some requirements are measured, and only in recognised phrasings. "No
  invented company details" is assessed by the model, and is shown as "Not verified" when
  it cannot be shown from the text.
- **L-76:** this run needed one "Continue" after the 12-step default window.
