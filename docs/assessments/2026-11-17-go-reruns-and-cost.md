# Go reruns, cost and the manuscript handoff (Sean, 15–17 Nov 2026)

Eight emails from Sean, including Paul's beta feedback, forwarded on 16 Nov. This note answers the questions he asked: what the money went on, what is supported now, and what was not built. Production data was read with SELECT only. Fixes are in #706–#716; their limits are in L-246 to L-250.

## What the money went on

### The book "Can a State Admit It Was Wrong?" (`be08b583`): 770 calls, $97.98

| Route | Calls | Cost |
|---|---|---|
| generate-section-prose | 275 | $59.08 |
| extract-section-record | 263 | $12.56 |
| generate-stage-artifact | 35 | $7.39 |
| agent/next-action | 44 | $4.65 |
| chat-message | 33 | $4.46 |
| evaluate-stage-artifact | 10 | $3.09 |

About $63 went on rewriting the whole 26-section manuscript 12 times (237 section rewrites) to apply a Chapter 5 retitle:
- The chapter plan's repair had already put the new title into the chapters before the first manuscript repair began.
- Snapshots v5–v9 are byte-identical, and so are v10–v13.
- Research (web search) cost $0.61 in all.

The mechanics:
- every written section was queued on each repair;
- Go waited 10 minutes for a pass that takes about 60;
- each Resume queued the whole book again while the last pass was still running.

**Email 1 asked whether the side chat's account had any credence.** Partly.
- It was right that the clean-up would not strengthen the argument, and that the evidence gaps are real.
- It was wrong about what Go had been doing. It was not "rechecking downstream stages": it was rewriting the manuscript, and the chat saw each step cut to 400 characters.
- "Continuity" (the feature that finishes cut-off drafts) ran once, for $0.58. The cost was the repair loop.

### Hidden Innovation (`5255e8e5`): 440 calls, $53.01

| Route | Calls | Cost |
|---|---|---|
| generate-stage-artifact | 60 | $14.77 |
| agent/next-action | 81 | $9.81 |
| apply-recommendations | 44 | $6.92 |
| evaluate-stage-artifact | 21 | $6.56 |
| continue-document | 20 | $2.63 |
| dependent-claims | 30 | $1.71 |

The window Sean asked about, $16.90 → $29.13 (calls #156 to #256), was mostly first-time work: the policy assessment, the outline, the manuscript sections and the review. Revisits in it came to about $5.4:
- plan versions v8/v9 after his tick: about $1.6;
- the corrections stage's draft, check and apply: $3.76.

From then until the sign-off, maintaining the extra manuscript copies cost about $16.6:
- the corrections stage, $10.57;
- the consolidated stage, $2.61;
- review rechecks, $2.51.

The plan's polish loop (v1 to v9) cost about $6.8.

## What is supported now (all on production, 17 Nov)

**Phase 1: a repair looks before it rewrites (#706–#709, #711).**
- A manuscript repair rewrites only the sections its reason concerns, and waits for a pass already running rather than queuing another.
- A section a rewrite does not concern costs about $0.05 instead of $0.27, because the model answers "unchanged".
- A stage reopened by an earlier change is first checked against that change, and is kept as it is if nothing in it relied on it.
- On a test book on production: a retitle cost $0.004 for the manuscript (Sean's cost about $63), and a later change to the brief was checked and kept on Review and the Final book for about $0.01 each.

**Phase 2: fixes land in the manuscript itself (#710).**
- The accepted findings of the review after a manuscript are carried into the chapters they concern.
- A stage that would only copy the manuscript is refused.
- An added stage may go back.
- Stale reasons name the current version, and an older version's check is folded away, labelled as such.
- An approval says which version it is for and what changed since.

**Phase 3: one list, answered once (#712, #713).**
- An answer on Go's card resumes the run only when nothing else waits; the panel says what was recorded and what still waits.
- Findings that say they are resolved are accepted in one press.
- A source check that only needs the full text is "pending research" and does not block the finish.
- Duplicate kept questions are listed once.
- One factual correction is made beyond the edit limit.
- The work Go went back to a manuscript for is carried into it. On production this rewrote one section (Chapter 1) for $0.15.

**Phase 4: the side chat and the start conversation (#714, #715).**
- The side chat names each button with its place ("under More at the bottom of the stage") and picks a button by what it does.
- A chip never promises to change another stage.
- "Build a plan with me" reads connected accounts and saves what it read into the project. On production it read Drive and Gmail; HubSpot was searched and returned nothing; Salesforce needs reconnecting.

**Phase 5: Go starts itself, and other items (#716).**
- Go starts itself after Start (Autonomous; a Settings switch turns it off). On production: Go started 6 s after the project was created, and the first draft was saved 25 s later.
- Re-attaching a document by name replaces it and its words in the context, and the change check reopens only what relied on it.
- Cost by stage is shown.
- The search decisions run on Haiku.
- A draft's account and web lookups run at once.

## Email 8's questions

| Question | Now |
|---|---|
| Reuse checks that are still valid | Yes. The deliverable and objective checks are reused while their version is unchanged, and a reopened stage that relied on nothing is now kept, not rewritten. |
| Recheck the work a change affects | Yes for brief and fact changes (one call names the affected stages) and now for earlier-stage changes (each reopened stage is checked first). A save still reopens later stages by position; the check is what keeps that cheap. |
| Say when it is finished, or exactly what blocks it | The run account now lists "Left for Go: …" and "N things wait on you". |
| Which steps drive the cost | Cost by stage, most first, beside "Where it went" by kind. |
| A small change gets a quick check, a big one a deeper review | Yes, in the sense above: the check decides between "kept" and a rewrite. Depth inside a rewrite does not vary. |
| Stages shortened, combined or skipped as the work calls for | Not built. Go can add up to 3 stages a run and skip an optional stage under Handle. Letting Go shorten, merge or drop stages itself means changing the event model and the gates. **Estimate: 6–9 days.** |
| Go starts when the project starts | Built, on by default. |
| A changed source carried through the drafts, with what changed shown | Built for a re-attached document (L-250). A changed web source or account item is not re-read. |
| A delegated decision carried forward unless something material changes | Under Autonomous with "Handle them for me", routine approvals are re-checked and re-committed on each version Go saves. Reserved approvals are re-asked, now with what changed since (L-247). |

## Paul's feedback (email 7)

- **Speed.** A first draft from "Build a plan with me" now takes about 30 s after the project is made, with Go starting by itself. Streaming the draft as it is written is not built. **Estimate: 1–2 days.**
- **Too many questions.** Go starting by itself removes the first press. The questions in the start conversation are unchanged.
- **Sources visible.** Kept: web sources, account items (now also from the start conversation) and data files are listed and cited.
