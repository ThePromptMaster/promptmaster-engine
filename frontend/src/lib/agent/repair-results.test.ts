import { describe, expect, it } from 'vitest';

import type { WorkflowState } from '@/lib/workflow/types';
import { shownOutstanding } from '@/lib/workflow/engine';

import { runAccount } from './account';
import { unsettledRepairs } from './needs';

const run = { status: 'completed', stop_reason: 'Done.' } as never;
const label = (id: string) => ({ plan: 'Core plan', docs: 'Documents' })[id] ?? id;
const repair = (stage_id: string, extra: Record<string, unknown> = {}) =>
  ({ action_key: 'recheck_stage', status: 'succeeded', stage_id, params: { stage_id }, changes: {}, output: '', ...extra }) as never;

describe('a run says what each repair came to (8 Nov: "repaired" while the check had failed)', () => {
  it('says repaired only when the stage closed again', () => {
    const did = runAccount(run, [repair('plan', { changes: { stage_closed: true } })], label)?.did;
    expect(did).toContain('epaired Core plan after a change');
  });

  it('a repair saved with its stage still reopened is not called repaired', () => {
    const did = runAccount(run, [repair('plan', { changes: { version_ids: ['v'], stage_closed: false } })], label)?.did;
    expect(did).not.toMatch(/\brepaired Core plan\b/i);
    expect(did).toContain('still reopened');
  });

  it('a repair that failed is said as failed, and only the last try counts', () => {
    const failed = runAccount(run, [repair('plan', { status: 'failed' })], label)?.did;
    expect(failed).toContain('ould not repair Core plan');
    const thenFixed = runAccount(run, [repair('plan', { status: 'failed' }), repair('plan', { changes: { stage_closed: true } })], label)?.did;
    expect(thenFixed).toContain('epaired Core plan after a change');
    expect(thenFixed).not.toContain('ould not repair');
    const thenFailed = runAccount(run, [repair('plan', { changes: { stage_closed: true } }), repair('plan', { status: 'failed' })], label)?.did;
    expect(thenFailed).toContain('ould not repair Core plan');
    expect(thenFailed).not.toContain('after a change');
  });

  it('a step from before this was recorded is read from its own words', () => {
    const closed = runAccount(run, [repair('plan', { output: 'Repaired Core plan (x) — saved as a new version and marked complete again; the earlier version is kept.' })], label)?.did;
    expect(closed).toContain('epaired Core plan after a change');
    const open = runAccount(run, [repair('plan', { output: 'Repaired Core plan (x) — saved as a new version; it stays reopened until: y.' })], label)?.did;
    expect(open).toContain('still reopened');
  });

  it('finishing cut chapters and fitting a limit are not repairs after a change', () => {
    const did = runAccount(run, [repair('docs', { params: { stage_id: 'docs', cut: true } }), repair('plan', { params: { stage_id: 'plan', measured: true } })], label)?.did;
    expect(did).not.toMatch(/after a change/);
    expect(did).toContain('measured in code');
  });
});

describe('a reopened stage Go has tried to repair says so wherever it is listed', () => {
  const state = {
    current_stage_id: 'docs',
    stages: {
      plan: { status: 'stale', stale: { reason: 'the budget changed', since: 't2' } },
      docs: { status: 'in_progress' },
    },
  } as unknown as WorkflowState;
  const tried = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) => repair('plan', { params: { stage_id: 'plan', ...params }, ...extra });

  it('counts the tries of this reopening and keeps the last result', () => {
    const steps = [
      tried({ stale_since: 't1' }, { output: 'an earlier reopening' }),
      tried({ stale_since: 't2' }, { status: 'failed', output: 'first try' }),
      tried({ stale_since: 't2' }, { status: 'failed', output: 'still gives $8,000 (the fact now: $13,000)' }),
    ];
    expect(unsettledRepairs(state, steps)).toEqual({ plan: { tries: 2, last: 'still gives $8,000 (the fact now: $13,000)' } });
  });

  it('a stopped or interrupted try is not a try, and a closed stage is not listed', () => {
    expect(unsettledRepairs(state, [tried({ stale_since: 't2' }, { status: 'interrupted' })])).toEqual({});
    const closed = { ...state, stages: { plan: { status: 'complete' } } } as unknown as WorkflowState;
    expect(unsettledRepairs(closed, [tried({})])).toEqual({});
  });

  it('adds the diagnosis to the line that lists the stage', () => {
    const item = { kind: 'stale_stage', stageId: 'plan', label: 'Core plan', reason: 'the budget changed' } as const;
    expect(shownOutstanding(item, 'en')).toBe('Core plan needs a recheck — the budget changed');
    const shown = shownOutstanding(item, 'en', { repair: () => ({ tries: 2, last: 'still   gives\n$8,000' }) });
    expect(shown).toBe('Core plan needs a recheck — the budget changed Go has tried to repair it and it is not settled (tries: 2). Last result: still gives $8,000');
  });
});

describe('a failed repair that saved its attempt is said to have saved it (9 Nov, production)', () => {
  it('counts versions, whatever the check said', async () => {
    const { repairStuckNeed } = await import('./needs');
    const state = { stages: { plan: { status: 'stale', stale: { reason: 'x', since: 't' } } } } as unknown as WorkflowState;
    const failedButSaved = repair('plan', { status: 'failed', changes: { version_ids: ['v9'] }, output: 'It is saved, so you can see it.' });
    const refused = repair('plan', { status: 'failed', changes: {}, output: 'Refused.' });
    expect(repairStuckNeed(state, 'plan', [failedButSaved, refused])).toMatchObject({ tries: 2, saved: 1 });
  });
});
