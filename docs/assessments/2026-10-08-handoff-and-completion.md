# Saved-work handoff, fact changes, and honest completion — assessment

*8–9 October 2026. In reply to the fourteen emails of 6–7 October. The code is in PRs
#164–#182; the table in §1 says which PR addressed each finding. Remaining limits are in
`docs/known-limitations.md`, L-56 to L-65. §7 records each test replayed on production.*

The short version:
- **Most of the generated work was right.** In your tests, the physics, the proofs, the
  portfolio arithmetic and the corrected code were correct as written. What failed was the
  handoff:
  - later stages never saw the saved documents;
  - a revision did not invalidate the review that had read the old version;
  - your answers and changed facts did not govern the stages after them;
  - "Objective met" and "optional" meant something different from what the code enforced.
- **What changed:**
  - Later stages read the full saved documents.
  - A revision reopens everything built on the version it replaced.
  - An answer to Go becomes a recorded decision.
  - A changed fact outranks the value written in the objective.
  - "Update affected work and resume" carries a change through to the final bundle, and
    checks the repaired text for any old value left behind.
  - Measurable requirements (word ranges, question counts, answered FAQs) are counted in
    code.
  - A finding carried forward no longer counts as met.
  - Rows labelled optional no longer stop Go.
  - A derivation Go works out is saved into the document.

---

## 1. Each test, what caused it, and what fixed it

| Test (email) | What you saw | Underlying cause | Fix (PR) |
|---|---|---|---|
| Sequence proof (1, 2) | Results said all three cycles "not_run"; Discussion said proved | The report's sections were drafted from 320-character summaries of earlier stages; the Analysis proofs never reached them. The runs table had no status for work done by hand | Full saved documents in every later stage (#164); report sections briefed from the source stages' saved text; a "Worked by hand" run status (#169) |
| Sequence proof (1) | "Objective met" after the findings were carried forward | Carry forward and Defer counted as resolved; the objective check read only one stage | A carried-forward finding that says something is missing or unmet is open work, and the check may not call the objective met over it (#168) |
| Sequence proof (1) | "Derive" three times, nothing saved | A derivation is text in the run, never a version. Only the loop guard stopped it | After one derivation, Go must save the work; the revision is given the derived text in full (#168) |
| Sequence proof (1) | Validation asked for a dataset | Stages were told "no data", with no exception for calculation from given values | Stages are told that a calculation from supplied values needs no dataset (#169) |
| Regge (1, 2) | Cycle record unresolved, yet "Objective met" | Already changed on 7 Oct (Go judges the objective before saying it is met); your test predated it. Carried-forward findings now also block | #154 (7 Oct), #168 |
| Physics review (2) | Go stopped on 7 rows labelled optional | Go's stop rule ignored the table's own "optional" label | One test decides whether a table's rows are required; the label, Go and the finish check all read it (#168) |
| Physics review (2) | "Internal instruction conflict about JSON vs Markdown" | The conflict check could quote system instructions as if they were yours | A conflict is kept only if it quotes your own words (#169) |
| Physics (2, 9, 10) | Stray commas, visible LaTeX | No maths rendering; no instruction on how to write maths | KaTeX rendering and LaTeX-writing rules (#172) |
| Python debugging (3) | "Code execution unavailable" | Running code was offered only in research workflows | See §2 (#172) |
| Workshop (4) | Summary kept presenting v1 after you saved v2 | A saved revision invalidated nothing, and Summary read a summary of Output written at completion | A save reopens the later work with the reason; Summary reads v2 in full (#164, #165). **Verified on production:** Summary rebuilt from v2 ("12:05, Feasible: no") and Go paused for your decision instead of offering Finish |
| Portfolio (5) | $8,000 and $9,000 flagged "unsupported"; 26 vs 25 | The figure check required every number to appear verbatim in your material; checks estimated coverage instead of counting it | Sums, differences and products of supplied amounts are supported (never derived percentages); checks must count the saved items (#169) |
| TeamNotes (6.1) | v3 at 94 words passed | No word count anywhere; a model judged it | Word ranges, question counts and answered questions are counted in code and block completion (#168) |
| TeamNotes (6.2, 6.3) | "No mobile app" called missing; "incomplete FAQ excerpt" | The check saw a 320-character summary of the FAQ | Full documents (#164). A "missing" claim whose quoted words are in the saved text is dropped in code (#169) |
| TeamNotes (6.4) | Benefit wording added | Nothing asked the check to look for it | Checks flag wording that no supplied fact supports (#169) |
| TeamNotes (6.5) | November 12 and $12 survived the change | The prompts said "the objective wins"; the repair did not state the new value; old figures were re-supplied; "Nov 12th" did not match "November 12"; Go repaired only up to the current stage | A later fact outranks the objective's value; the repair states old → new and is checked for leftovers; Go repairs through to the final bundle; "Update affected work and resume" (#167) |
| TeamNotes (6.6) | Optional findings blocked Go | As in the physics review | #168 |
| TaskBoard (8) | Your Dec 10 / $18 answer: evaluation and Summary still said "unresolved"; 95 words passed as 105; FAQ unanswered; Output complete while its check said incomplete | An answer was a run step, not a project fact. No word count | The answer is recorded as a fact (#166); word and question counts (#168); Go does not advance past a failed check (#168) |
| ClearDesk (11) | Summary "waiting for" decisions already given | As TaskBoard, plus a stale "not met" verdict that nothing cleared | #166: answers become facts, and a verdict older than a later answer is treated as to be checked again |
| iPhone photos (12, 13) | Photos could not be added | HEIC was not accepted, there was a 5 MB cap, and the side chat refused images | HEIC converted to JPEG; large photos scaled; the side chat takes photos (#170) |
| Workshop setup (14) | Setup lost on sign-out; verification omitted, then refused | Setup lived only in the page. The designer silently dropped a closing check, and a revision that put one last was refused | Drafts are saved and offered back (#171, #181). A closing verification is kept, after all four deliverables, followed by a Finalise stage that applies its corrections (#182) |

## 2. Code execution (email 3)

That was expected behaviour then, and it is now changed. Running code was offered only
in Research and in custom workflows that investigate something; Single output was
treated as writing.

Now, when a written stage contains Python and the objective asks for it to be tested,
checked or run, Go may run it in the sandbox in any workflow:
- it runs the code exactly as written, then each test case the objective names, printing
  expected, actual and PASS/FAIL;
- the step is labelled as executed, from what actually happened, as research runs are;
- code that was only written, never run, is never presented as having passed.

Limits that stay:
- Python only, with a fixed set of packages and no network (L-B3).
- Go must be running: the stage draft itself does not execute code.

## 3. Folders, people records and connected information (email 7)

**What the architecture supports today.** Each project owns:
- its **files**, stored under row-level security, with the text extracted from them;
- its **accepted facts**, each with its source, who accepted it, and a history of
  superseded values;
- its **decisions and events**.

Every model call reads the project's current facts. A changed fact reopens the work
that used it, and Go can now carry the change through.

That is project memory scoped to one project. There is nothing yet for a person,
company or document that exists **across** projects, and no connection to any outside
system.

**What it would take**, in the order you suggested:

1. **Records and folders.** New tables:
   - `entities`: a person, company or document, owned by the user, with a type;
   - `entity_links`: an entity's role in a project (candidate, client, source);
   - `entity_facts`: like `project_facts`, but attached to an entity, with `source`,
     `retrieved_at`, `refreshed_at` and a `kind` of retrieved / your note / AI assessment.

   Confidential notes and assessments stay project-scoped (`project_facts` that
   reference the entity), so a person can appear in two searches without the notes
   crossing between them. The folder view groups a project's linked entities by type.
   *About 6–8 days, including the UI.*
2. **One integration, read only.** Salesforce Contacts and Accounts through OAuth, using
   Vercel Connect, so tokens never touch our database.
   - "Import from Salesforce" creates or updates the entity's retrieved facts, citing the
     record and timestamp.
   - A value that differs from another source (two phone numbers) is shown as a
     **conflict** to resolve, never silently overwritten. This reuses the existing
     supersede history.
   - *About 5–7 days.*

   LinkedIn has no general data API: we would store the profile link and what you paste.
   ZoomInfo needs your API contract before we can scope it.
3. **Rules.**
   - Matching: email first, then name + company, with a confirm step.
   - Refresh: on demand plus a nightly re-read of linked records.
   - Access: row-level security per user, with an explicit sharing table if teams need it.

   *About 3–4 days.*
4. **Use in workflows.**
   - A project's linked entity facts join the facts block every prompt reads.
   - A refreshed value that changes a fact reopens the affected work through the same
     path as today's fact change.

   *About 2–3 days*, because most of the machinery exists.

Writing back to Salesforce is a separate capability. Each write would be shown to you
first and recorded, the same reserved-decision rule Go uses for anything outside the
project.

**Practical first step:** (1) plus the Salesforce read-only import for Contacts. It sets
the record structure every later integration fills, and it is useful on its own for an
executive search project.

## 4. Formatting for physics and code (emails 9, 10)

Built in #172:
- **Defaults:**
  - equations drawn with KaTeX (fractions, matrices, subscripts, Greek, aligned
    multi-line derivations) with "Copy LaTeX";
  - code with its language named, its indentation kept, and Copy / Download buttons
    that output the exact text;
  - dollar amounts left as money, never misread as maths.
- **Exports:**
  - LaTeX (`.tex`, amsmath, maths as written, code verbatim);
  - PDF through the print view, with the same rendering;
  - Word keeps code and equations verbatim in a fixed-width font.
- **Prompts** ask for LaTeX maths, `aligned` derivations, no comma where `=` belongs,
  fenced code naming its language, and a plain statement of whether code was run.

**Recommended next, not built:**
- **Jupyter notebook export (.ipynb).** Each stage's prose and equations become Markdown
  cells and each code block a code cell. Code that Go actually ran carries its recorded
  output and error as cell outputs; code that was only proposed has none and is marked
  "not run". About 2 days.
- **Optional settings** for physicists, which we would leave off by default:
  - equation numbering;
  - a choice between inline and display maths in exports;
  - a BibTeX file from the literature table.

## 5. Your acceptance criteria (email 1)

| Criterion | Status |
|---|---|
| Completed calculations and proofs reach the final report, with run statuses reconciled | Built (#164, #169). Replay on production in progress |
| A requested repair saves a new version or says why it failed | Built (#167: leftover values; #168: a derivation must be saved; the no-progress stop says nothing was saved) |
| Unmet objective requirements prevent "Objective met"; carrying an issue forward does not satisfy it | Built (#168) |
| Routine decisions follow the delegation settings; necessary human decisions explained | Built (#168: optional rows; a second proposal pass under "Handle them for me") |
| This test finishes with three cycles, both full proofs and sum checks of 0, 1, 5 and 14 | To be replayed on production with the real model; the result will be added here |

## 7. Tests replayed on production (9 October)

All of these ran on promptmaster-engine.vercel.app with the real model. Go was set to Autonomous with "Handle them for me" unless noted.

| Test | What happened |
|---|---|
| Workshop (4) | Output was revised to an 80-minute exercise (v2). Realign and Summary were reopened ("Output was revised (now v2)…"). Go rebuilt Summary from v2: "12:05, Feasible: no". It then paused for your decision on which requirement to relax, instead of offering Finish. |
| TaskBoard (8) | Go stopped before drafting and asked for the date and price. Your answer became a recorded fact ("your answer to Go"). The draft and Summary treated it as settled. The production pass found three more problems (the conflict check ignored the fact; the objective check read "ask me first" as unmet; a stale notice could hide the update button), all fixed (#173, #174). |
| TaskBoard price change (6.5) | The price was changed $15 → $16 in Facts. Every stage was reopened, including the in-progress Summary. "Update affected work and resume" left the output saying $16 six times, with no $15 or $18 left, and Summary agreeing. Fixed along the way: #175 (a fresh step window; lists of excluded values), #176 (drafts in progress), #177 (repair tries counted per reopening). |
| TaskBoard word count (8) | The checklist now reads "Announcement: 100–140 words — 74 words", required, and "FAQ: exactly 5 questions, each answered" ✓. Go would not say the objective was met: "…the launch announcement does not meet the required 100–140 word length". (The word range had first been attached to the FAQ; fixed in #180.) |
| Portfolio (5) | B + D + E, $10,000, 18 points. No total was flagged "unsupported". Summary counted the 26 combinations against the saved table's 26 rows. It caught a real error ("A + C + D", $9,000, marked over budget). Answering "fix it" reopened Output; the row was repaired; then "Objective met" was declared with a correct quote. |
| Physics and Python (2, 3, 9, 10) | Damped oscillator in Single output. 94 equations rendered (59 display, each with Copy LaTeX) and no raw LaTeX. Two Python blocks with language labels and Copy/Download. Go **ran** the tests ("Code executed"), and the output reports PASS for each. The Export menu has LaTeX (.tex). |
| iPhone photos (12, 13) | A HEIC was converted to JPEG and stored. A 20.2 MB photo was reduced to 4.4 MB and stored. |
| Setup draft (14) | "Your setup is saved as a draft — you can sign out and continue later." After a reload, "You have an unfinished setup from 9 Oct, 03:39…" restored the text. The workshop design now ends schedule → budget → invitation → briefing → final verification → Finalise. |
| Sequence proof (1) | Research, Autonomous with routine decisions handled. **The final report states all three cycles from the saved record**: the counterexample at n = 2 (a₂ = 1, against 2² − 1 = 3); Binet's formula proved by induction from both base cases; the partial-sum identity Sₙ = aₙ₊₂ − 1 proved by induction; and the explicit checks S₁ = 1, S₃ = 4, S₅ = 12 = a₇ − 1. Go never declared "Objective met" while the report said otherwise. Getting there took six fixes, each found on this replay: a repeated Derive on Analysis is saved into the document instead of repeated (#183); a repeated Derive on a finished table moves on (#184); an unchanged report judged "not met" is not judged again, and the work moves on to Revision (#185); a section revision reads the latest saved record, not the outline's copy taken at approval, and that copy is no longer cut at 4,000 characters (#186); a table repair no longer saves its "What changed" note as a row (#187); chapters no longer open with the "I followed … I set aside …" line meant for a reply (#188). Still open on this project: 15 proposed statuses on the finished Alternatives and Validation tables, which are the user's to confirm, and confirming them means reopening those stages (L-66). Also: my own answer to Go wrongly said the n = 5 check was in the Experiment record (it was done in Analysis), and Go took it as authoritative (L-65). |

## 8. Hours

- Phases 1–6 (eleven PRs): about 2.5 days.
- Fixes found on the production replays (#173–#177, #180–#188): about 1 day.
- Production replays of all nine tests and this assessment: about 0.5 day.
- Estimates for what remains are in §3 and §4.
