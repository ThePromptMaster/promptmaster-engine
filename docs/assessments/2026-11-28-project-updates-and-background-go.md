# When a project changes after the work exists, and Go working without the page

*28 November 2026. In answer to Sean's emails of 26–27 November: the payroll, Calder, Cedar Street and museum
tests; "PromptMaster after a project changes"; "One more thought on stages"; the addendum on how an update is
shown; and "Background Go runs".*

## What the two saved cases did

**Payroll cutover.** The final pack was right. The task list was not, and that was a separate store that
nothing kept up to date.
- Each time Go checked the objective on the pack, it recorded the actions the pack named as tasks. Each task was
  a sentence of the pack, word for word.
- Nothing in the change path touched tasks. The only thing that ever closed one was a rule for a date or a
  `[placeholder]` that disappeared. "Run S4 on the old system" has neither, so it stayed open through every
  update. By the end there were 16, from three checks.
- "Carried forward" showed every open task on every stage, which is why the Source log showed them.
- The Source log itself missed the two newest sources. The second update was matched to the stages that repeated
  the changed lines, and the log paraphrases each source beside its id, so it was never reopened.
- "Last check was on v1": a repair re-confirms a stage's approvals against the new version but does not run the
  full stage check, and the panel said "not checked yet".

**Calder.** A source-matching bug.
- "This supersedes CAL-01 for Alex Rivera only" was read as the number **01**. The check that a repair no longer
  states a replaced value then matched every "-01": Morgan Lee's CAL-01 and the template's FIRM-01.
- It also read the replacement as applying to everyone, not only Alex.

## The smallest durable fix, and what shipped (all live)

| | What changed |
|---|---|
| A task follows its sentence (L-315) | A task Go took from the work is current while the work still says it. When a newer version no longer does, the task closes in code, and one small call says why with words found in the facts: **done** ("South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)"), **replaced**, or **reworded** (the new words open as a task). The history keeps each closed task with why and the change behind it. While its stage is being redone after a change, a task is **on hold**. The task panel, the finished screen and the status line read one list. Run on your saved payroll data: the 9 stale tasks close and the N8 work stays. Your own list reconciles when you next open the project. |
| A change reopens what cites its source (L-316) | A stage that cites OPS-02 or BANK-04 is reopened when that fact changes, however it words it. |
| A check says which version it covers (L-317) | "v4 was re-confirmed after the change on …", with the full check under its own version. An approval given on an earlier version says so. |
| Ids and one-person exceptions (L-318) | CAL-01 is read whole. "For Alex Rivera only" is checked only where the text is about Alex, sentence by sentence; "Lee: CAL-01" is Morgan's. |
| Limits on the part they name (L-319) | Cedar: "newsletter" listed among the drafts is that draft, measured under its heading where it is written, never on the checklist. An answer naming the part is read. |
| Routine edits keep moving (L-320) | Museum: Go no longer polishes a version you approved, checks a version before asking you again, decides a finding that only relabels earlier findings, and reads "i2–i4" as i2, i3 and i4. A question says what each answer changes for the people doing the work. |
| Latest update and statuses (L-321) | The card and status line described below. |
| Older facts can't stand as current (L-322) | A version Go saved after the facts changed under it reopens its stage, with its own event (fixed in the second pass: the first version never reached the database). |
| One action, one task; findings under Handle (L-331) | From the second pass, below. |
| Rounds with nothing new (L-323) | Found while rerunning your tests: "maintain and wait for updates" workflows looped round after round with nothing to take in. Now Go moves on to the records instead. |

## Your tests, rerun on the live site

Each case was rebuilt in our own account from your emails.

| Case | Result |
|---|---|
| Payroll handoff | The check recorded 7 tasks. After South's completion report and West's W4 update, the tasks were on hold while the handoff was redone. Then South's run and report closed as **done**, quoting the report, and West's W3 tasks were **replaced** by the W4 ones. North's tasks stayed. Opening the page again changed nothing. |
| Calder | After CAL-03, every repair passed. Alex's contact-sheet task was retired as replaced by "stays internal". "Make exactly one reference call, then send the written summary" was added. Morgan's sheet still goes to Calder under CAL-01. Linden and the template were untouched. |
| Cedar Street | The blurb was measured at 27 words on the drafts, and the checklist was never held to 70. After the date and cost change, the web brief and newsletter went to version 2, and ED-01 was recorded as invalidated for them and still valid on the caption (version 1). There was no repair loop. |
| Museum | Go finished the round and moved on to the records instead of starting another. It checked them before asking for approval, and after approval it finished without rewording the approved version. After carton B's acceptance was withdrawn, the records reopened and went to OPEN, with B2 on the dispatch list. It checked the repaired version before anything else. When receipt 614 synced again and Sales asked to close, the log recorded it "as a duplicate sync rather than a second delivery", and the records kept the job open and corrected Sales. No question about i2–i4 was asked. The status line reads "Written v5 · checked v4 · approved v3 · still open in the world: Dispatch carton B2…". |

Other cases, rerun on the live site in a second session: Alder (both updates, every repair passed, and the limit
held on the Executive update alone), the Studio A seat limit, Windward, and the quick answer taken into the full
process.

### A second hand pass, of everything first checked only by tests

Every item a unit test alone had covered was then run by hand on the live site, forcing a failure where it would
not happen on its own. That pass found eight more problems, all fixed and live (L-331 and dated additions to
L-318 to L-322):
- **The "older facts" reopening (L-322) had never worked live.** It was written as a brief change, which the
  database allows only from the user, and the refusal was swallowed; its test mocked the write. It is now its own
  event, and was seen working: a fact added while Go was repairing reopened that stage, and Go redid it.
- **A fact added while nothing was finished was not recorded as a change**, so a first draft written from the
  facts before it could not be caught.
- **One real-world action appeared many times on the task list.** "Dispatch carton B2" appeared eleven times in
  the museum rebuild, once each time Go set the question aside, in new words. One action is now one task, and
  the repeats close as "the same action as …".
- **Under "Handle them for me", the objective check stopped on findings that are Go's to decide** (payroll i9,
  museum i8). Go now goes on to decide them, and puts to you only what is yours.
- **Go asked for approval of a repaired version it had not checked**, because earlier checks had used up its
  polishing limit. A version nothing has checked is now always checked first. When a check says a version
  misses the objective and Go has stopped revising it, the approval says so.
- **The Latest update card listed the older of two changes first**, and the newer fell out of view. Newest first
  now.
- **Two more false "still gives" refusals.** One was "the original target was Week 6 Friday" in a row marked
  superseded. The other was "the launch target in D1", read as replacing D1. A third, "45 staff instead of 30,
  and the budget is now $2,000", read $2,000 as the old value. All three are fixed.
- **"The 60-word limit applies only to the SMS reminder", typed as a fact, changed nothing.** It is now read as
  a requirement, and retires the same figure said earlier.

Seen by hand in that pass:
- a stop ending when the version it asked about is replaced;
- the "blocked" line in the Latest update card (forced);
- "v4 was re-confirmed after the change";
- "given on v2; the current version is v4";
- a reworded task opening at once;
- Go leaving an approved version alone.

Model spend for all of the rebuilds and passes was about $35.

Still covered by tests only:
- your own payroll list reconciling (it is your account; the fix was run against your saved data instead);
- a folder rule keeping a value current;
- the hint to say which part a limit belongs to after a failed repair;
- the open-findings branch of the objective check under Handle. A finished check table can't be set back to
  undecided without reopening it.

## How the app decides what to rerun today

There are three triggers, and they behave differently.
1. **A fact you change or take out.** Matched by content: the stages whose text uses the old value, or now cites
   its source id. Only those reopen, each with the sentence.
2. **A brief edit, or a fact you add.** One small model judgment per finished stage: did it rely on this?
3. **A new version of an earlier stage.** Here **stage order** decides. Every finished stage after it reopens.
   Then, before rewriting each one, Go checks it against what changed and closes it as it is when nothing in it
   relied on it.

So, to your question: the order of stages drives the reruns that follow a rewrite, not the first reopening.
That is where a project pays for checks that turn out to change nothing. Each version already records what it
used (`inputs_used`). Using that record to decide what reopens is the step that would make updates follow the
actual dependencies. I would do that before adding an editing mode.

## What "Complete" means

Today "complete" means the stage's requirements were met on its current version. That includes approvals, and
those stand for the version they were given on. The app has always kept these apart:
- written;
- checked (the stage check, or Go's re-confirmation after a change);
- approved by you;
- done in the world.

It did not show the difference where you look. Each stage now has one line when they differ, for example
"Written v9 · checked v8 · approved v8 · still open in the world: Deliver carton B2…". "Done in the world" is the
task list, so it is known only when a fact reports it. PromptMaster cannot see a payroll run happen.

## "Change it", and editing versus updating

"Change it" in the side chat already does both of the things you describe, in one step. It edits the deliverable
as a new version, and it records any fact you leave ticked as a project update, which reopens what relied on it.
The edit itself also reopens the stages after it, by order. That is the part that makes a typo fix cost more
than it should.

The smallest version of your split:
- **Edit this deliverable.** It saves and checks only the edited stage, with no fact recorded. The stages after
  it are reopened only when the edit changes a value they use.
- **Update the project.** This is the facts panel, reachable from any stage.

I would build that after the dependency step above, because the dependency step is what makes "Edit" cheap.

## Background Go

**What runs on the server after the app closes today.**
- The job runner (`/api/jobs/drain`, every minute) does exactly two things:
  - writes the sections of a long document;
  - sends, schedules and follows up outreach email.
- The Go loop itself (the planner, every step, and the step budget) runs in the browser. Closing the tab pauses
  the run.
- On reopening, a run resumes where it stopped. A step that was cut off is marked interrupted and is not
  repeated. The project and policy are fixed for the run, and authority is read from the project each time.
- New information mid-run: a save is refused if the stage's text changed under it. With L-322, a version saved
  from facts that changed meanwhile reopens its stage.
- Retries: an interrupted step is not replayed, and section jobs are keyed so they are not written twice. Go can
  still append a near-duplicate version if it chooses the same move again.

**What can be reused.**
- The run and step tables, and the leases (`agent_runs.lease_holder`, `heartbeat_at`).
- The job runner with its lease and retry model.
- The worker credential pattern from outreach.
- The resume path.
- The change summary and the new Latest update card, which is what you see on return.

**What has to be built for a first testable slice.**
- A server worker that takes an authorized run and performs its internal steps one per tick, using the
  existing step performers. These are drafts, checks, repairs and task updates; never an approval or a send.
- The step budget counted on the server, and pause and cancel from the page.
- A facts stamp on each step, so a result made from older facts cannot land (extending L-322).
- On return: the Latest update card plus the run's steps, saying what was checked on which version and where it
  stopped.

**Estimate: about 8–12 working days for that slice, on one project.** Most of it is making the step performers
run without the page (they read and write through the page's stores today), then testing an interruption and a
second edit mid-run. Waking on an event (a new source, an approval) is a smaller step once this works.

**My recommendation is to do it after the dependency step above.** Your Calder and payroll checks are the
acceptance tests for both.
