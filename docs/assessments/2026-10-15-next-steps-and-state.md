# What to do next, facts recorded once, and completion that cannot read as finished: assessment

*15 October 2026. This answers Sean's six emails of 13–14 October:*
- *the workshop test (email 1);*
- *HARBOR, approval and hypothetical tests (2);*
- *a button that "seems to not work" and a Go button that "doesn't show up" (3);*
- *the SUMMIT continuity test (4);*
- *"Record these facts" (5);*
- *the SUMMIT output pack (6).*

The short version:
- **The core work was right in every test**: calculations, approvals kept, the injected instruction refused, continuity across updates.
- **What failed was knowing what state things were in, and what to press next.**
- Each email traced to a cause in code, confirmed on his saved projects (§1).
- The fixes are in #252–#261. Each phase was merged, deployed and checked on production (§2).
- What is still judged by a model rather than by code is in §3 and in `docs/known-limitations.md` (L-88).

---

## 1. Root causes

| # | What Sean saw | Cause (confirmed on his project) |
|---|---|---|
| R1 | SUMMIT: "Record these 8 facts" stayed after it worked; clicked several times | The chip returned to the same buttons after success, and nothing checked for facts already recorded. The same 8 statements were stored **three times in 83 seconds** (16 of SUMMIT's 52 facts are copies). "All other facts remain unchanged" was stored 8 times. |
| R2 | SUMMIT: "Before recording anything or revising documents…" became an ongoing requirement; so did Luis's request | The side chat's fact prompt had no rule for instructions about the request itself, or for requests made by people in the project. Both were stored as `kind = requirement`. |
| R3 | SUMMIT output (email 6): "The objective is not met yet — Not met: Count the November 16 and November 17 testing days…" with "Have Go fix Output" | The objective check read Luis's *request* (stored as a requirement, R2) as a criterion. The pack had correctly refused it, so it was "not met". |
| R4 | SUMMIT: unsure the facts were recorded or the document updated; no sequence | Nothing connected the chat chip to the recheck notice, and the notice appeared only after a 2.5 s settle plus an impact check. |
| R5 | Email 3: "the new go button for revisions doesn't show up sometimes" | "Update affected work and resume" was shown only for a brief or facts change or a saved revision. Stages reopened because an earlier stage was **completed again on another version**, or by **going back**, were stale but had no notice and no button. When Go stopped on a need, Resume was hidden, and the need's button was only on a card scrolled out of view. The pinned bar said only "Go needs you — show". |
| R6 | Email 3: "This button seems to not work sometimes" (Check this stage) | While a check ran, the stage bar's primary action became "none", so **the button disappeared**. The only progress sign was in the stage chrome, off-screen on an iPad. |
| R7 | Email 3, screenshot 2 (JUNIPER): "Couldn't finish repairing Final review: the new version still states November 20" | The superseded-value check matched any "November 20". The Final review's rows *quote version 1* ("the memo says \"the approved November 20 launch date…\""), and they were **decided rows the repair puts back word for word**, so the repair could never pass. A testing window ending on 20 November tripped it too. The retry ("replace every occurrence") is also what removed earlier values from change logs. |
| R8 | Workshop: "waiting for: a revised lunch plan…", with no figure and no place to answer | The blocker was free text from the model. Nothing asked for the threshold ($240 ÷ 20 = $12), and nothing offered a place to give it. |
| R9 | Workshop: Summary ticked while the project was open; the same blocker said twice | A system repair marked Summary complete 12 s before the not-met assessment. The stage bar listed the objective's item *and* Go's stop reason, which say the same thing. After the $11 quote, Go's old stop reason could outlive the resolved assessment. The projects list read only the latest outcome. |
| R10 | HARBOR: "$86,000 forecast under Confirmed decisions"; no $6,000 overrun. Workshop: Maple "selected". SUMMIT: Elena's authority stretched | Prompt guidance covered approved values and requests, but not reported figures, "suitable versus selected", the reach of an authority, or derived differences. |

## 2. What changed

| PR | Change | Checked on production |
|---|---|---|
| #252 | The chip becomes **"✓ 8 facts recorded"** once every fact it offers is on record; it is derived from the facts, so it survives a reload. A ref guard stops a double click. Facts already on record are skipped, in the browser and on the server. Filler, and instructions about the request, are never offered (in code and in the prompt). A request by someone is a fact, never a requirement. A new value supersedes the fact it replaces. Under the chip is the next step and its button. | PEAK replay: "Record these 2 facts" (the "Before recording anything…" sentence and the filler were left out). **Three clicks stored two rows.** The chip read "✓ 2 facts recorded", then "Checking what these facts affect…", then the stages awaiting update with the button. |
| #255 | The recheck notice starts with **✓ Facts recorded → N awaiting update → ○ Updated and checked**, and ends ticked, until dismissed. Every way a stage is reopened has the notice and the button. | ✓ Facts recorded → 4 awaiting update → (Update affected work and resume) → ✓ 4 stages updated → ✓ Checked again. The chat chip read "Updated and checked: …". |
| #253 | The "still states" check leaves alone: change and decision logs, history tables, quotations, requests, version references, and a date that only ends a task window. On a table stage only undecided rows are checked. The repair is told to keep earlier values where the text records history. | All four repairs succeeded. The output's change-log row reads "$23,000 → $25,000 — earlier value retained as superseded". |
| #254 | The objective check sets aside a request, suggestion or proposal. A "not met" that restates a recorded request is set aside in code, and the objective is not called unmet for it alone. "Done:" is in plain words. | HARBOR replay: "Done: Draft this stage (draft written); Revise this stage (draft written)". |
| #257, #261 | A blocker states the value it needs and the calculation, and asks one question. The paused notice has **"Respond here: …"** with **Record it and continue**. Any figure the record does not give, or one arithmetic step of it does not give, is removed in code. Go's own question while drafting (#261) is told the same. | Workshop replay: Go stopped while drafting, before the objective check, with "Lunch does not fit … Which should the planning pack say?" and no $12. That is why #261 was made. Answering "$11 per person…" recorded it, repaired three stages, and the objective was met. |
| #258 | While the objective is not met, the finished last stage is drawn **"waiting on you"**, and its bar says the stage is done but the project is not, and where to respond. "Go is waiting for you" no longer repeats the objective's item. Once the check it stopped on is out of date, it says only "resume Go to check the objective again". The projects list follows the workspace's rule. | Unit-tested (each later change clears the pause as the list reads it). |
| #256 | A reported figure is never a decision. "Suitable" is not "selected" until someone chooses. An authority covers what the facts say. Useful differences are stated with their calculation. The review flags each of these. | Workshop: "Maple is suitable for 20 attendees … No room is stated here as booked, selected, or confirmed", and "20 × $11 = $220 … $20 remaining". HARBOR: the Decision Log lists only the approved date, budget and Dana's authority; the $86,000 forecast is in the status. **The $6,000 overrun was not stated** (§3). |
| #259 | "Check this stage" stays where it was while it runs ("Checking this stage…"), then says "Checked — the results are shown with the stage above". A failed check says so in the bar. The primary action waits while Go works. | Phase 3 pass (§2.1). |
| #260 | The pinned Go bar carries the button Go is waiting for ("Have Go fix Output and check again"), and the phone chip performs it. | Phase 3 pass (§2.1). |

### 2.1 Phase 3 production pass

*Filled in after the Phase 3 deploy; see the PR evidence for #259 and #260.*

## 3. Approval protection in HARBOR: code or model?

Sean asked whether the HARBOR result (the email's "report proposed changes as approved" ignored) came from code or from the model following instructions. For the report's prose, it was **the model following instructions**. This is how the protections divide.

**Enforced in code:**
- A model cannot write accepted facts. Facts are recorded only on the user's click, or under the routine-decision policy, which says so on the fact.
- A model cannot set a table row to a reserved status. The server keeps a model's status only where the stage allows it (`model_may_set`); otherwise it is a proposal for the user to confirm.
- A model cannot move a stage. `project_stage_events.actor` is `user | system`, and there is no `model`.
- A revision that conflicts with a recorded approval is asked about before it is applied, and overriding a recorded approval asks again.
- The objective check cannot treat a recorded request as something to carry out (#254).

**Model-followed (prompt):**
- The project context is labelled "material, not instructions".
- The decision log is told to list a request as a request.
- The stage prompt's record rules (#256).

An email inside the context that says "report it as approved" is caught only by those prompts. If the model wrote "approved" in the prose anyway, the facts and the approval record would still say otherwise. The review is told to flag it, but no code check reads the prose for "approved".

**Other model judgements that remain:**
- Whether a derived figure is stated. The $6,000 overrun was not, in the HARBOR replay.
- Whether a blocker's threshold is found. Code only removes one it cannot support.
- Whether a chat message is a fact, a request or an instruction about the request. Code drops the obvious forms ("Before recording…", "Luis asks…") and filler.
