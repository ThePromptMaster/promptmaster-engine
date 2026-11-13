# Two notes from 12 Nov: an approval asked for over an unnamed approver, and connecting Salesforce, HubSpot and Office files

13 November 2026. What was asked, what the client's own run showed, what changed, and how each change was checked. Limits are in `docs/known-limitations.md`, L-239 to L-241.

## What was asked

1. "Go marked a draft approval as routine, then stopped and asked me to approve it because the original plan didn't name an approver. Could Go just record 'approver not specified' and keep moving when the plan is already stated as approved?"
2. "Can we hook this up to Salesforce? Zoominfo? Hubspot? Word? Office? Excel?"

## What the run showed

Read from production (SELECT only) before any change. The stop was on the second stage of an executive-search simulation, under "Handle them for me".

| Step | What happened |
|---|---|
| Draft, version 1 | The decision log said `Approved; approver not recorded` about a plan the brief called the "original approved plan". Correct. |
| Stage check | The code rule for approvers read the fact "Original approved plan: interview three…" as a person called *Original* who had approved it, and raised "Approver on record: name the approver the project records". |
| Apply | The line became `Approver: to confirm`. |
| Routine approval | Go's check refused "I approve these drafts as the common base for both options" over that placeholder. |
| Stop | Two rounds of check-and-apply had used the stage's four polishing moves. With no Revise left, the approval was handed to the user: "Needs your approval", with no reason. He approved 15 minutes later. |

So the placeholder came from a false finding of ours, and a refused routine approval with no revision left went to the user.

## 1. The approver stop (#676, #677, L-239)

| Change | Where |
|---|---|
| "Approved" in front of the thing it describes names nobody; a word after "Approver:" is a name only when written as one | `lib/workflow/approver-support.ts` |
| Where the material calls something approved and names nobody, the record is "approver not specified": never "to confirm", never a question | `stage.py` (`HISTORY_RULE`), `project_context.py` (`SUPPLIED_RULE`), `criterion_check.py` (`APPROVER_RULE`), `question_screen.py` |
| A refused routine approval gets one repair, for what the check named and nothing else, then is checked again, even when the polishing cap has taken Revise away | `lib/agent/needs.ts` (`refusedCommits`, `refusalToRepair`, `requiredWork`), `use-go-loop.ts` |
| A second refusal is still the user's, and the card says what the check said | `needs.ts`, `need.approvalRefused` in 8 languages |
| A refusal counts for the version it checked; a step's finish is written on the database's clock | `needs.ts`, `perform.ts`, `lib/supabase/server-clock.ts` |

The last row was found by forcing the case on production. The repair ran, and the user was asked anyway. A step's start is stamped by the database and its finish was stamped by the browser, which was 31 seconds ahead; the refusal of version 3 carried a time later than version 4, so it read as a refusal of version 4, which was then never checked. The comparison is older than this work, so on any device running ahead of the database by more than a revision takes, a routine approval refused once was not checked again after Go revised the stage.

| Check | How | Result |
|---|---|---|
| The client's fact and decision-log row | Unit tests on the exact text | No finding |
| The routine check on his own stage text | Real model, local script | "approver not recorded" approved 5 of 5; "Approver: to confirm" refused 3 of 3, each time naming "approver not specified" as the record; after the one repair, which changed that one cell, approved 3 of 3 |
| A fresh copy of his brief, end to end | By hand on production, "Handle them for me" | 23 steps to "Objective met". Two stops only: the A-or-B choice and the final sign-off (`media/nov13/01-ab-question-no-approver-stop.jpg`, `02-decision-recorded.jpg`). Every version says "Approver not specified"; no approver finding was raised |
| One refusal at the polishing cap | By hand on production, the stage check and the routine check altered in the page so the run follows his sequence: check, apply, check, apply, refused | Repair at the cap ("I changed only the two status cells for the original approved plan"), checked again on the new version, approved, moved on. No stop |
| Two refusals | The same, with the second check altered too | Repair, check again on the repaired version, then the stop, with the second check's words on the card (`media/nov13/03-second-refusal-card-with-reason.jpg`) |
| The clock | Unit tests on the times that run recorded | Not a refusal of the repaired version |

Not seen by hand: Go asking who approved something already called approved (a prompt rule; no run asked); "Approver: unknown" no longer read as a person (unit tests).

## 2. Office files (#678, L-240)

Word already worked: a .docx can be attached, read from Drive or OneDrive, and exported.

A defect was found on the way. A spreadsheet or a deck handed over from Drive or OneDrive was decoded as if it were text, so a project received the bytes of a zip file as its "words".

| Change | Where |
|---|---|
| An Excel file from Drive or OneDrive is read as its rows, each sheet under its name | `lib/data/spreadsheet.ts`, `extract-text.ts` |
| A PowerPoint file is read for the words on its slides, from Drive or OneDrive and as an attachment; hidden slides and speaker notes are left out | `extract-text.ts` (`pptxText`), `preview.ts` |
| Bytes that are not text are refused, not passed on as words | `extract-text.ts` |
| "Excel" in the export menu and the finished panel when the work holds a table: one sheet a table. The assessment table downloads as Excel beside CSV | `lib/export/xlsx-export.ts`, `markdown-tables.ts`, `export-menu.tsx`, `project-finished.tsx`, `assess-renderer.tsx` |

| Check | How | Result |
|---|---|---|
| A real deck with a hidden slide and speaker notes, and a workbook, attached at the start | By hand on production, then a database read | "330 characters of text · goes into the project context"; the project's context holds slides 1, 2 and 4 and neither the hidden slide nor the note; the workbook became two CSVs as before (`media/nov13/05-pptx-and-xlsx-attached.jpg`). The answer written from it quotes the deck's two costs and their difference |
| Excel from the export menu | By hand on production; the workbook the page made was unzipped and read in the page | Four sheets named after their headings, header rows, the numbered column as numbers, no formula anywhere (`04-export-menu-excel.jpg`) |
| Excel from the finished panel | By hand on production | The same workbook, 7,040 bytes (`07-finished-panel-export-excel.jpg`) |
| The assessment table as Excel | By hand on production, on a test project from 25 Oct | One sheet, the header and four rows (`06-assessment-download-excel.jpg`) |
| An old .ppt, and a zip named .txt | By hand on production, on a project's data panel | "is in the old PowerPoint format. Save it as .pptx or PDF first." and "could not be read (it is not a text file)"; a second deck was offered for the project context (`08-old-ppt-and-zip-refused.jpg`) |

Not seen by hand: an .xlsx or .pptx read from Drive or OneDrive (neither is connected on the test account; the reading is the same function the attachment used, and is unit-tested from a Drive file's bytes); the exported file saved to disk and opened in Excel itself (it was read from what the page produced).

## 3. Salesforce and HubSpot (#679, #680 held, L-241)

Composio, which already holds the Google and Microsoft connections, offers both with its own sign-in. The backend can now search and read contacts, accounts and opportunities in Salesforce and contacts, companies and deals in HubSpot, as one more kind of item, read only, a fixed list of fields per kind, ids checked before they reach a query.

| Check | How | Result |
|---|---|---|
| The backend's parsing, search, read, id checks and disconnect | 18 tests against scripted records | Pass |
| Production lists both, and Composio gives a sign-in link for each | By hand on production (the link was not followed) | Seven accounts listed; a link returned for each |
| A real account | | **Not run.** No call has been made against a real Salesforce or HubSpot account. The screens (#680) are held until one has |

ZoomInfo: nothing built. Composio's ZoomInfo connection needs the customer's own ZoomInfo client id and secret.
