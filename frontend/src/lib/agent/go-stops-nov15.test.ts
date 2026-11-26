import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({ api: {} }));
vi.mock('@/lib/workflow/conflict-trail', () => ({ findInstructionConflicts: async () => [] }));

import { performStep, type PerformContext } from './perform';
import { allowedActions } from './policy';
import { describeNeed } from './needs';
import { planFromScreen, type QuestionScreen } from './question-screen';
import { waitForStageChange } from '@/components/workflow/use-go-loop';
import { recordDecisionReason } from '@/lib/workflow/decision-options';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';

/**
 * Sean, 13 Nov, Saturday Workshop Plan (run 134cfe5f): Go "declared the
 * objective complete" on Schedule & budget with Email, Check and Revision
 * unwritten, and stopped saying "Revision is written, but the work is not
 * finished: Revision is not written yet". Then, after a long pause on his
 * iPad, it moved on from Email three times without the page moving.
 */
const T = SINGLE_OUTPUT_V1;
const first = T.stages[0];

function ctx(policy: 'autonomous' | 'checkpoint', routine: 'handle' | 'ask', events: unknown[] = []): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A workshop plan', model: 'm', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {}, routine_decisions: routine },
    template: T,
    state: { current_stage_id: first.id, stages: { [first.id]: { status: 'in_progress' } } },
    stage: first,
    bundles: {},
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy },
    step: { action_key: 'declare_objective_complete', params: {}, rationale: 'Done.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    appendStageVersion: vi.fn(),
    afterStageEvent: async () => undefined,
    loadEvents: async () => events,
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

describe('nothing is judged finished before it is written', () => {
  it('is not offered while the deliverable is unwritten and a later stage can be worked', () => {
    const state = { current_stage_id: first.id, stages: { [first.id]: { status: 'in_progress' as const } } };
    expect(allowedActions(T, state as never, first, true, undefined, {}, true)).not.toContain('declare_objective_complete');
    expect(allowedActions(T, state as never, first, true, undefined, {}, false)).toContain('declare_objective_complete');
  });

  it('under "handle them for me", reached anyway, the run carries on rather than stopping', async () => {
    const out = await performStep(ctx('autonomous', 'handle'));
    expect(out.stop).toBeUndefined();
    expect(out.output).toMatch(/^Not finished: .+ is not written yet\. Still to write: .+\. Carrying on with /);
  });

  it('otherwise it stops with what is left, never "X is written" about something unwritten', async () => {
    const out = await performStep(ctx('checkpoint', 'ask'));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'not_written' });
    const card = describeNeed(out.needs!, (id) => T.stages.find((s) => s.id === id)?.label ?? id, {}, 'en');
    expect(card.message).toMatch(/^The work is not finished: still to write — /);
    expect(card.message).not.toMatch(/is written, but/);
    expect(card.options?.map((o) => o.id)).toEqual(['resume', 'stop']);
  });

  it('a stage already drafted is not "still to write", and Carry on names the next unwritten one (16 Nov, hand pass)', async () => {
    const c = ctx('checkpoint', 'ask');
    c.bundles = { [first.id]: { artifact: null, versions: [{ id: 'v1', version_number: 1 }] } } as never;
    const out = await performStep(c);
    const labels = T.stages.map((s) => s.short_label ?? s.label);
    const firstLabel = first.short_label ?? first.label;
    expect(out.needs).toMatchObject({ finding: 'not_written', next: labels[1] });
    expect((out.needs as { items: string[] }).items).not.toContain(firstLabel);
    const card = describeNeed(out.needs!, (id) => T.stages.find((s) => s.id === id)?.label ?? id, {}, 'en');
    expect(card.options?.[0].label).toBe(`Carry on to ${labels[1]}`);
    expect(card.message).not.toContain(`— ${firstLabel};`);
  });
});

describe('a question Go cannot act on now moves the work on (15 Nov)', () => {
  const screen = (over: Partial<QuestionScreen>): QuestionScreen => ({ verdict: 'routine_repair', reason: 'Routine.', instruction: 'Remove the Option B line.', target_stage: '', action: '', requirement_quote: '', ...over });
  const base = { question: 'Section 3 still says "Recommendation: Option B". Should I remove that line now?', template: { stages: [] } as never, stage: { transitions: {} } as never, returnsLeft: 3 };

  it('a routine repair with no edits left goes on to the next stage and keeps the question', () => {
    const plan = planFromScreen(screen({}), { ...base, allowed: ['advance_stage', 'declare_objective_complete'] });
    expect(plan.kind === 'repair' && plan.move.action_key).toBe('advance_stage');
    expect(plan.kind === 'repair' && plan.move.params).toEqual({ set_aside_question: base.question });
  });

  it("Go's own extra is left out, never asked (guest invitation: a backup volunteer)", () => {
    const plan = planFromScreen(screen({ verdict: 'optional_suggestion', suggestion: 'A backup volunteer for refreshments and bins.' }), { ...base, allowed: ['revise_stage'] });
    expect(plan).toEqual({ kind: 'leave_out', suggestion: 'A backup volunteer for refreshments and bins.', reason: 'Routine.' });
  });

  it("the user's decision also takes out a recommendation it rules out", () => {
    expect(recordDecisionReason('Option A: no refreshments')).toMatch(/A recommendation, option or line that the decision rules out is removed or rewritten/);
  });
});

describe('moving on is written once (15 Nov, three "moved on" events for Email)', () => {
  it('an advance the event log already holds writes nothing again', async () => {
    const next = T.stages[1];
    const c = ctx('autonomous', 'handle', [
      { type: 'stage_marked_complete', stage_id: first.id, to_stage_id: next.id, created_at: '2026-11-14T00:23:34Z', payload: {} },
    ]);
    const refreshed = vi.fn(async () => undefined);
    const out = await performStep({ ...c, afterStageEvent: refreshed, step: { action_key: 'advance_stage', params: {}, rationale: 'Move on.' } } as unknown as PerformContext);
    expect(out.changes).toEqual({ caught_up_to: next.id });
    expect(out.output).toMatch(/already complete and the project is on /);
    // 16 Nov, hand pass: the page is brought up to the log, so the next move is
    // not chosen on the finished stage.
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('the loop waits for the page to show the new stage', async () => {
    let stage = 'email';
    setTimeout(() => { stage = 'check'; }, 200);
    expect(await waitForStageChange(() => stage, 'email', 2_000)).toBe(true);
    expect(await waitForStageChange(() => 'email', 'email', 300)).toBe(false);
  });
});

describe('only rechecks Go does itself are open: under "handle them for me" it carries on (26 Nov, ops plan pass)', () => {
  const last = T.stages.at(-1)!;
  const middle = T.stages[2];
  function done(policy: 'autonomous' | 'checkpoint', routine: 'handle' | 'ask', recent: unknown[] = []) {
    const c = ctx(policy, routine);
    c.stage = last;
    c.deliverableDone = true;
    c.state = {
      current_stage_id: last.id,
      stages: Object.fromEntries(T.stages.map((s) => [s.id, s.id === middle.id
        ? { status: 'stale', stale: { reason: 'The work went back to Budget after this stage used it.', since: '2026-11-26T23:00:00Z', was: 'completed_with_artifact' } }
        : { status: 'completed_with_artifact' }])),
    } as never;
    c.context = { ...c.context, artifactNonEmpty: Object.fromEntries(T.stages.map((s) => [s.id, true])), manualChecks: Object.fromEntries(T.stages.flatMap((s) => s.exit_criteria.filter((x) => x.check === 'manual').map((x) => [x.id, true]))) } as never;
    c.digest = { recent_steps: recent } as never;
    return c;
  }

  it('says what is open and goes on to it, rather than asking whether to carry on', async () => {
    const out = await performStep(done('autonomous', 'handle'));
    expect(out.stop).toBeUndefined();
    expect(out.output).toMatch(/needs a recheck.*It is all work I do myself, so I carry on with it/);
  });

  it('a second time straight after, it stops as before', async () => {
    const recent = [{ action_key: 'declare_objective_complete', status: 'succeeded', execution_label: null, output: 'The deliverable is written, but the work is not finished: x.' }];
    const out = await performStep(done('autonomous', 'handle', recent));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'work_open' });
  });

  it('under "ask me" it stops as before', async () => {
    const out = await performStep(done('autonomous', 'ask'));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'work_open' });
  });
});
