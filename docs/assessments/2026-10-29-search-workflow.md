# A search workflow for an executive-search client: assessment

*29 October 2026. This answers Sean's email of 28 October. He wants to set up a candidate search once — its requirements, criteria and scoring scale — and then paste or upload profiles one after another without re-entering anything. He also asks about combining records, personal and team files, and connecting to Salesforce. For each, it separates what works today from what would have to be built, gives hours, and recommends the smallest useful first version. Nothing here has been built; Sean wants to approve it first.*

The short version:
- **Most of the core loop exists today.** The **Assessment** workflow (Criteria → Assess → Shortlist, live since 25 Oct, #395) already does the following:
  - the criteria and scale are set once;
  - profiles are pasted a batch at a time without repeating instructions;
  - every row records its verdict, the quoted evidence, and what the profile **does not say** (`gaps`). The model is told never to fill a gap with what is typical.
- **What is missing for real search work:** each row does not record *which version* of the criteria judged it; a profile cannot be uploaded straight into Assess; and nothing measures consistency. Together these are about **10–13 hours**, and this is the recommended first version.
- **Teams and shared files do not exist.** Every table is private to its owner by design. This is the largest item (**40–60 h**), and it needs decisions before it can be estimated firmly.
- **There are no connectors today.** PromptMaster talks to OpenRouter (models and web search), OpenAlex (literature) and Vercel Sandbox, and nothing else. A read-only Salesforce import is an integration (**20–30 h**) plus access to the client's Salesforce org. A Salesforce report exported as CSV works as a stopgap.

---

## 1. What already works

| Sean asked for | Today | Where |
|---|---|---|
| Configure the search once | The Criteria stage holds the requirements and the criteria. Every Assess batch is judged against them | `templates/assessment.v1.ts` |
| Paste profiles one after another | Each paste is up to 12 profiles (40,000 characters) and appends to one table. Earlier names are passed along, so a batch never re-judges them | `routers/assess.py`, `promptmaster/assessment.py` |
| Same scoring scale every time | The first batch fixes the scale: traffic light, 1–5, pass/fail, A–F, fit, or one you write. A verdict that is not on the scale is cleared, never guessed | `lib/workflow/assess.ts`, `assessment.py` |
| Show the supporting evidence | Each row has `evidence`: up to three short quotes from the profile itself | `assessment.py` |
| Identify missing information rather than guess | Each row has `gaps`. The prompt says *never invent experience, dates, employers, figures or qualifications… where the text does not say something a criterion needs, say so in `gaps`*. A criterion about a protected characteristic is ignored, and that is noted | `assessment.py` |
| A person can overrule the model | The override is kept, and the model's original verdict stays beside it | `assess.ts` (`model_verdict`, `verdict_source`) |
| Criteria versions recorded | **Partly.** The criteria are an ordinary stage, so every change is a new version in the history. The prompt names the version it used, but **the row does not record it** | `saved_documents.py` |
| Export | The table downloads as CSV for an applicant tracking system | `assess.ts` |
| Upload a profile | **Partly.** A project's files accept PDF, DOCX, TXT, MD, CSV and XLSX, and the text is extracted. That text reaches the project's context, **not an Assess batch** | `lib/data/extract-text.ts` |
| Consistency across repeated assessments | **No.** The temperature is 0.2, so it is low but not fixed. A re-paste adds a second row, and nothing compares the two | `assessment.py` |

## 2. What would need building

| # | Capability | What it means | Hours |
|---|---|---|---|
| A | **Criteria version on every row** | Each assessed row stores the criteria version it was judged against. When the criteria change, the table shows which rows used an older version and offers to re-assess them. The scale lock is also enforced on the server (today it is enforced only in the page) | 4–5 |
| B | **Upload profiles into Assess** | Drop PDFs or DOCX files (or pick from the project's files), with one profile per file, through the extraction that already exists | 3–4 |
| C | **Consistency check** | Re-assess selected rows, or the whole table, against the same criteria and report agreement (same verdict / one level apart / different) with the evidence side by side. Recorded so it can be shown later | 3–4 |
| D | **Combined record, originals kept** | Choose several profiles or materials and make one record that lists its sources. Each original stays readable on its own. *Comparing* candidates keeps them in separate rows, as now. Merging duplicate profiles of one person is a separate, explicit action | 8–12 |
| E | **Personal and team files** | Teams, membership, and roles (view / edit / share). Every table's privacy rules are reworked around the team. A personal file used in a team project stays private unless its owner shares it: the project shows that something private was used, but not its contents. Teammates' access to generated outputs needs its own rule | 40–60 |
| F | **Salesforce import** | Read-only: a Salesforce connected app with OAuth, a picker for searches and candidate records, and import into the project as files or Assess rows. Needs the client's org and an admin to approve the app | 20–30 |

The hours cover building, tests, and a production check, in the way of the earlier phases.

E is the uncertain one. It touches the rule that every row belongs to one user, which the database enforces and the contract evidence relies on (`project_stage_events`, composite owner keys). It needs a short design and Sean's decisions before a firm estimate:
- who can invite;
- whether outputs default to team-visible;
- what happens to a departed member's files.

F depends on what the client's Salesforce actually holds: standard Contact and Opportunity records, or a recruiting package.

## 3. Recommended first version

**A + B + C, about 10–13 hours**, trialled with the client's process owner on a real search:
1. Set up one search in the existing Assessment workflow, using her criteria and scale.
2. Upload or paste a first set of profiles. Every row then carries evidence, gaps and its criteria version.
3. Re-run a sample to show consistency.
4. Change one criterion and show which rows used the old version.

This answers the core request — configure once, assess many, fixed criteria, recorded versions, tested consistency — without waiting on teams or Salesforce. Until those exist:
- **Team use:** one shared login per search, or share the CSV.
- **Salesforce:** a report exported as CSV and uploaded.

D can follow once the trial shows how records are actually combined. E and F each need their own decision first.

## 4. Next steps and dependencies

1. **The client's process owner:** the screening steps, the criteria for a real search, the scale she uses today, and 10–20 anonymised profiles to test with.
2. **Sean:** authorize A–C. Decide whether teams (E) are needed for the pilot or after it.
3. **Salesforce (F):** which objects hold candidates and searches, and an org admin who can approve a connected app. Until then, CSV export.
4. **Then:** a focused session with the process owner on a live search, as Sean suggested.
