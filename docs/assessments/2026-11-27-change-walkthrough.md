# One fact that several pieces of work rely on: a walkthrough on the live site

*26–27 November 2026. In answer to Sean's email of 25 November, "Where I want PromptMaster to stand out".*

Sean asked for one example, run on the current build. He wanted to see:

- what happens when a fact that several pieces of work rely on changes;
- how the project works out what needs updating;
- what he can check when he reopens it.

He also asked what is ready to demo and which gap to close first. This is that example, run on production on a project in our own account.

## The example

**"Operations plan with a change midway"** is on Examples (`/examples/ops-plan`). Everything in it is invented. A food distributor, Lakeside Provisions, is opening a chilled room. The work has six stages:

| Stage | What it holds | How it uses the delivery date |
|---|---|---|
| Brief | What is being opened, who does what, the $55,000 cap | Not at all |
| Delivery timeline | Every date worked out from the delivery date | States it |
| Staffing schedule | Who is on site on which day | States it |
| Budget | Units, crew, commissioning, contingency against the cap | Not at all (costs only) |
| Customer commitment | The note to Bayview Grocers: the day their orders move | Relies on it without stating it (the switch date is worked out from it) |
| Operations plan | The plan the team works from, with a key-dates table | States it |

The supplier's delivery date is one fact: "Northwind Refrigeration delivers the two cooling units on March 3, 2027." The commitment and the plan are approvals only the user can give, because they go out to other people.

## What happened

### 1. The first run

Go ran the six stages under "Handle them for me". It stopped twice, for the commitment and the plan, and said why each was the user's to give. I approved both and finished the project. Then I recorded who had received what:

- the commitment, v3, to Bayview Grocers by email;
- the staffing schedule, v1, to Harbor Crew Hire;
- the plan, v3, to the operations team as a Word document.

The record of the plan was made from the export: after a Word export, the stage it came from offers "Record who has v3".

### 2. The supplier moves the date: March 3 to March 17

I reopened the project and changed the one fact in Facts. Within a few seconds the notice said:

> Changing the accepted facts means Delivery timeline, Staffing schedule and Operations plan need a recheck. Budget and Customer commitment will be checked once Delivery timeline is updated; everything else stands.

- **Still usable:** Brief.
- **Being redone:** Delivery timeline, Staffing schedule and Operations plan, each with the sentence that stated the old date. The Budget and the Customer commitment will be checked once the timeline is updated.
- **Needs you:** nothing yet.

"Apply and continue" handed it to Go:

| Stage | What Go did | Why |
|---|---|---|
| Delivery timeline | Redone (v3): every date moved two weeks | It stated the old date |
| Staffing schedule | Redone (v2) | It stated the old date |
| Budget | **Checked and kept** (v2): "nothing in Budget relied on what changed" | Moving the crew booking is free with notice; no figure moves |
| Customer commitment | **Redone** (v4): the switch date moves from March 16 to March 30 | It relied on the timeline, though it never stated the delivery date |
| Operations plan | Redone (v4) | It stated the old date |

Go then stopped at the commitment, because its approval was given on the March 16 text. It said:

> Needs your approval: "I approve this commitment to send to Bayview Grocers". This one is yours alone: it sends something to people outside this project, and only you decide what goes out.

It also said what was ready meanwhile:

> Ready to use now: Brief v1, Delivery timeline v3, Staffing schedule v2, Budget v2. Comes after this decision: Operations plan.

Each stage also says who has which version, and what has changed since:

> v3 went to Bayview Grocers on Nov 26, 2026 (email). Current is v7, changed since: …

It offers "Record v7 as sent" and "Keep v3 with them". Both were used and both work.

Go also found a weakness in the sample itself. The commitment asked Bayview to update a delivery address that the facts never give, so Go asked how to handle the placeholder. I answered that the room is in the existing warehouse and the address does not change. The example's instruction is now fixed.

### 3. A second change: Harbor's day rate, $360 to $410

The notice said the Budget and the Operations plan state the rate, and that the Customer commitment would be checked once the Budget was updated. Go redid the Budget and found the total now over the cap:

> $55,154 total − $55,000 approved = $154 over the cap. The plan is not within the approved $55,000. The approver of the cap is the finance director.

Go redid the Budget and the Operations plan. It checked the Customer commitment and kept it, since the switch date does not move.

To stay within the cap, Go then set the contingency to what the cap leaves: $4,860 (9.7%) instead of 10%. The budget and the plan both say so, with the sums, and that there is now nothing to spare. Go settled this itself under "Handle them for me" and did not ask. Whether a trade-off like this should be put to the user is a fair question (gap 5 below).

After fixing the budget, Go first stopped to ask "Carry on with the open work?" about two rechecks it does itself. That was an unneeded stop, and it is fixed now: under "Handle them for me" Go says so and carries on.

### 4. Reopening later

On opening the project after both changes, "Since your last visit" listed:

- each change, with the old fact and the new one and the stages it reopened;
- each stage redone, to which version and by whom;
- what was checked and kept;
- what was recorded as sent;
- then where the work stands now.

The project timeline shows the same record: each change expands to "Was / Now" and the reasons. For any version, "What this used" names a fact that has been replaced since it was made.

## What is ready to demo

- **Changing a fact.** You can see which work reopens and why, and which work is kept and why. It holds for a fact the work states, and for one it relies on through an earlier stage (the commitment).
- **Routine updates without approval prompts.** Go redid five stages after the date change without asking anything. It stopped only for the two things that go out to people.
- **Each stop says what is needed, why it is the user's, and what is ready meanwhile.**
- **Who has which version.** The record, the "current is v7, changed since" line, and "Record v7 as sent" / "Keep v3 with them" all work.
- **Picking up later.** "Since your last visit", the timeline and "What this used".
- **A change that breaks a requirement is said, with its arithmetic.**

## Gaps, and the first one to close

1. **Go stops the whole run at an approval**, even when other stages do not depend on it. The card says what is ready, but Go does not carry on with independent work. In this example nothing was left to do meanwhile, so it cost nothing. In a project with parallel deliverables, it would.
2. **A stage that relies on a fact without stating it is found by one model check, not by a record of what it used.** Here it found the commitment correctly. Everything a stage used is recorded (`inputs_used`) but not yet used to decide what to reopen. Today the order of stages does that, so the Budget was reopened and then checked. It was kept, but it cost a check.
3. **"Last visit" is per browser.** The timeline is the full record on any device.
4. **A sent record is the user's word.** PromptMaster sends nothing, so it cannot confirm what was sent.
5. **A trade-off a change forces can be settled by Go.** The crew-rate change broke the cap. Under "Handle them for me", Go met the cap by shrinking the contingency, which was an instruction, not a requirement, and said so plainly. Some teams would want that put to them. If so, a change that can only be met by giving up something the brief or a stage asked for should become a stop.

**I would close 2 first.** It is what makes the answer to "what did this change affect?" provable rather than judged, and at change 30 that is the difference between trusting the notice and checking every deliverable by hand. Gap 1 is the larger change, and is worth doing once a project with parallel deliverables shows the cost.

## A side-by-side test

**Design.** Give PromptMaster and a plain chat (ChatGPT or Claude, same model where possible) the same project and the same sequence of changes. Three runs of each.

**Project.** The operations plan above: the facts, the six deliverables, and the cap.

**Changes, in order:**

1. The delivery date slips two weeks (March 3 to March 17).
2. The crew's day rate rises from $360 to $410, which puts the budget $154 over the cap.
3. Bayview asks to move its switch date one week later.
4. A fact is restated in different words with the same meaning (nothing should change).
5. The delivery date slips again (March 17 to March 24).

**Checkpoints, after changes 1, 3 and 5:**

| Checkpoint | How it is measured |
|---|---|
| Stale outputs | Each deliverable's final text is searched for every replaced value (the same check PromptMaster runs on itself, `leftoverValues`), counted per deliverable |
| Decisions that should have been revisited | Was the commitment re-approved after its date moved? Was the over-cap budget put to the user rather than left as within the cap? |
| Valid work reopened for nothing | Deliverables rewritten when nothing they rely on changed (the brief always; the budget on changes 1, 3 and 5) |
| Manual cleanup | Count of the user's own edits, re-pastes and "please also update X" prompts needed to get every deliverable consistent |
| Cost and time | Model spend, and wall-clock time to a consistent set |

**What PromptMaster should show:**

- fewer stale values and no missed re-approvals;
- no rewrite of the brief or the budget except on change 2;
- close to no manual cleanup.

It will cost more per change than a plain chat (see below). The question is whether the cleanup saved is worth it.

## Cost and time of this run

Model spend, from the project's own usage record:

| Part | Model calls | Cost |
|---|---|---|
| First run to the finished plan (Go, both approvals, finish) | 57 | $2.61 |
| The date change: rechecks, the commitment's address question, re-approvals | 64 | $2.61 |
| The rate change: budget, plan, commitment check | 39 | $1.89 |
| **Total** | **160** | **$7.11** |

Wall-clock time from creating the project to the end was about an hour, most of it my own pauses between steps. Each update after a change took Go 3 to 6 minutes.

While running this I fixed five things on the live site:

- the change notice said "Everything else stands" while it listed work still to be checked;
- each line under "changed since" carried Go's whole note to the user;
- the example asked the customer for an address the facts never give;
- under "Handle them for me" Go stopped to ask about two rechecks it does itself;
- "Since your last visit" left out the plan's newest version, and listed the budget as both kept and redone.
