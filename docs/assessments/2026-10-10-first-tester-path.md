# The first-time tester's path — assessment

*10 October 2026. In reply to Sean's note of 9 October forwarding Harold's feedback.
Sean asked two things without changing scope: which existing workflow best shows a
first-time tester what PromptMaster is for, and what that tester should be able to
complete. Harold asked four: who it is for, how it differs from another AI tool, when
help becomes friction, and what its main job is. Everything below describes what the
product does today; §5 lists the small fixes made on the way, none of which adds a
capability.*

The short version:
- **Recommended first workflow: Single output.** Five stages, one approval only you
  can give, a deliverable in about two minutes from a goal and nothing else. Research
  is the second session, for a tester with a real question and an hour.
- **Who it is for:** people whose work has to be defended afterwards — analysts,
  auditors, lawyers, strategists, researchers. Not people who want a quick answer.
- **Its main job:** take a goal to a finished, checked deliverable, keeping a record of
  how it got there.
- **What a chat does not do:** check the work against your objective in a separate
  pass, hold your facts and requirements and repair the work when one changes, keep
  every version, and — under Go — do the stages for you while stopping for the
  decisions that are yours.
- **Where help became friction,** measured on production before any change: no
  questions were asked, but the deliverable answered "no data was provided" instead of
  recommending, and finished planning stages offered an extra AI check where "move on"
  was meant. Both are fixed (§5).

---

## 1. Who it is for, and its main job

Harold is right that a tool for everything is a tool for nothing in particular. The
product as built is narrower than the landing page suggested:

| | |
|---|---|
| **For** | Professionals who answer for their output: analysts, auditors, lawyers, strategists, researchers. The common need is not "write this", it is "write this so I can stand behind it". |
| **Main job** | A goal in, a finished deliverable out — a memo, a report, a research write-up, a book — with every stage, version, check and decision on record. |
| **Not for** | A one-off question, a quick rewrite, a chat. ChatGPT is faster for those and we should say so. |

## 2. What it does that a chat does not

Each line is something the code does now, not a plan.

| PromptMaster | Where it lives |
|---|---|
| A separate pass scores the work against **your** objective — alignment, clarity, drift, completeness — and "Realign to the objective" fixes drift as a new version | `backend/promptmaster/evaluator.py`, `realigner.py`; `components/workflow/evaluation-panel.tsx` |
| Stage exit criteria are rules checked in code, never a model's opinion; approvals that are yours stay yours | `lib/workflow/engine.ts`; the `authority` field in each template |
| A facts ledger: accepted facts and requirements go into every prompt, and changing one reopens only the work that depends on it | `lib/workflow/facts.ts`, `fact-dependencies.ts`, `brief-change.ts` |
| Every version kept, append-only; a figure in the text is checked against your material | `artifact_versions` (trigger-enforced); `lib/workflow/figure-support.ts` |
| Go does the stages itself and says in three lines what it did, what it is doing, or exactly why it stopped; every step is recorded, and what was *run* is told apart from what was only *written* | `lib/agent/account.ts`, `labels.ts`; `docs/architecture.md` § Go mode |
| When only an expert can decide, a review package for that expert | `lib/agent/expert.ts` |

## 3. When help becomes friction — measured, not guessed

On production at 8dec462, signed in, goal typed with nothing attached: *"Write a one-page
memo recommending whether our 12-person team should move from Slack to Microsoft
Teams. Budget is $8,000 a year."*

| Step | Result |
|---|---|
| "I know what I want to do" | Setup in 13 s. Single output recommended ("a single deliverable, not a long project"). **No questions asked.** |
| Start → the deliverable | 6 clicks, about 2 minutes, most of it drafting |
| **The deliverable** | Concluded "stay on Slack", because no pricing, usage or integration data had been supplied. It listed the gaps instead of recommending. |
| Finished planning stages | The main button was "Check this stage" (one more AI call); moving on was under a menu |
| The Single output card | "No stages to work through", directly above "5 stages" |

Harold's question tree was already short: "I know what I want to do" asks nothing, and
"Guide me" is told three questions is usually enough and never asks more than six. The friction was
elsewhere:
- **The output declined to do the job without materials.** A rule from 4 October
  forbids unsourced figures. That rule is right, but the model read it as "decline when
  material is missing".
- **Planning stages asked for a check where moving on was meant.**

## 4. The recommended workflow, and what a tester should complete

**Single output**, because:
- it has the fewest stages (5) and one reserved approval;
- most of our production replays ran on it;
- everything in §2 except Go's research runs shows up in one short session.

Research shows Go at its strongest but runs for hours, with four or five approvals that
are yours. Book and Exploration have no production replay on record yet.

**Tester script, about 20 minutes:**
1. Sign in and press **New project**. Type a real work goal in one sentence, including a
   figure or two. Press **I know what I want to do**, then **Start**.
2. Move through Input and Review to **Output** and read the deliverable. Press **Check
   this stage** and read the scores and the fixes it suggests.
3. Apply a fix or use **Realign**, then open the version history: the old version is
   still there.
4. Open **Facts and requirements**, change a figure (say, the budget) and press
   **Update affected work and resume**. Only the parts that used it change.
5. Open Go and press **Let Go run this**. Go finishes the remaining stages and stops for
   your acceptance. Accept, then export to Word or PDF.

**What the tester should be able to do, as pass criteria:**
- reach a deliverable within about 5 minutes, answering at most one question;
- finish the script without being told which button to press;
- name one thing PromptMaster did that a chat would not have done.

If testers miss the third, that is the answer to Harold's comparison question, and worth
more than any feature.

## 5. Fixes made on the way

None of these adds a capability. Each removes friction from the path in §4.

| | Change | PR |
|---|---|---|
| P1a | The landing page described the retired five-phase product. It now says who PromptMaster is for, what it does, and what a chat does not. An empty project list offers three example goals. | #209 |
| P1b | With no material supplied, a deliverable still does its job. It uses general knowledge stated as such and figures labelled "Assumption: …", reaches the conclusion they support, and lists what would change it. Missing material is never the whole conclusion. | #208 |
| P2a | After a recommendation, **Start** sits directly under it, with the line that everything below is optional and stays editable. No field is hidden. The Single output card no longer says "no stages". | #210 |
| P2b | On a finished planning stage (the objective statement, the prompt) the main button moves on, and the check is under More. The deliverable stage still leads with the check. | #211 |
| P2c | **Let Go run this**: one button sets Autonomous and "Handle them for me" and opens the authorization. Two clicks instead of five. Approvals that are yours still stop it. | #212 |
| P3 | An end-to-end test of this path: a goal alone, then the primary button at every step, to Go reporting the objective met. | #213 |
| P3b | Found on the production pass: when the model provider refused a review stage's draft (out of credits), the stage said "the draft came back empty", and Go retried blind twice. It now says why. | #214 |

## 6. Measured again after the fixes

Production, 10 Oct, after #208 to #212 were deployed. The account had existing projects.

| | Before (baseline, §3) | After |
|---|---|---|
| Questions asked before work starts | 0 | 0 |
| Clicks from goal to first deliverable | 6, two of them in a "Decide" menu | 4: I know what I want to do → Start → Continue to Review → Continue to Output |
| Time from goal to first deliverable | about 2 min | about 1.5 min |
| What the deliverable concluded, with no material attached | "No pricing, usage or integration data was provided, so stay" | Slack→Teams memo: "Stay on Slack unless Teams is already in your Microsoft licensing", with labelled assumptions and the facts that would change it. Four-day-week brief: "Run a pilot outside busy season, not a firm-wide switch this year." |
| Clicks to hand the rest to Go | 5 | 2: Let Go run this → Authorize and go |

**Not yet measured:** a full Go run to the reserved acceptance on production. On the four-day-week brief, Go checked Output, applied the findings, moved on and skipped Realign. It then stopped on Final review because the model account had run out of credits (HTTP 402). That is an account limit, not a fault in the path, but the message it showed was wrong; #214 fixes that. The replay will be repeated once credits are restored. The scripted run of the same path (#213) does reach "the objective is verified as met".

**Still open:**
- Prices are still not estimated. The Slack→Teams memo names cost as the deciding question but gives no working figure for either product. It is better than refusing, but a chat would offer a ballpark.
- The draft still starts about one and a half screens down the page, below guidance, the mode card, the Go panel, setup, facts and data. Each panel was asked for. No change was made, but a tester will scroll.
