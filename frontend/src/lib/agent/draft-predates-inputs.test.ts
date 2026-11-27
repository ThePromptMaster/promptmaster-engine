import { describe, expect, it } from 'vitest';

import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';
import { draftPredatesInputs, lastBriefChangeAt, stageHasCurrentDraft } from './policy';
import type { WorkflowState } from '@/lib/workflow/types';

// 27 Nov (Sean, Alder Quay; L-328): "Final packet was still on the original
// v1 and counted all 853 words … Go tried to fix it … and stopped without
// saving a new Final version." Final v1 was the quick answer carried into the
// full process (15:03:54); Draft and Check were redone after it, and Final was
// entered only then. Its old text was taken as Final's draft and repaired.
const t = SINGLE_OUTPUT_V1;
const [input, review, output, realign] = t.stages.map((s) => s.id);
const v = (created_at: string, content = 'text') => ({ versions: [{ created_at, content }] });
const state = (stages: WorkflowState['stages']): WorkflowState => ({ current_stage_id: output, stages, project_status: 'active' } as unknown as WorkflowState);

describe('a draft older than the work before it, held since before the stage was entered (L-328)', () => {
  const carried = '2026-11-27T15:03:54Z';
  // Sean's first dated update, after the carried answer and before Draft was redone.
  const changed = '2026-11-27T15:20:00Z';
  const bundles = { [input]: v('2026-11-27T15:24:00Z'), [review]: v('2026-11-27T15:25:30Z'), [output]: v(carried) };
  const entered = state({
    [input]: { status: 'completed', entered_at: '2026-11-27T15:03:55Z' },
    [review]: { status: 'completed', entered_at: '2026-11-27T15:24:10Z' },
    [output]: { status: 'in_progress', entered_at: '2026-11-27T15:25:40Z' },
  } as WorkflowState['stages']);

  it('is not the stage\'s current draft: Go writes it from the work before it', () => {
    expect(draftPredatesInputs(t, entered, output, bundles[output].versions[0], bundles, changed)).toBe(true);
    expect(stageHasCurrentDraft(t, entered, output, { content: 'old quick answer', created_at: carried }, { bundles, changedAt: changed })).toBe(false);
  });

  it('a draft written after the stage was entered stays current, whatever came before', () => {
    const own = { ...bundles, [output]: v('2026-11-27T15:26:00Z') };
    expect(draftPredatesInputs(t, entered, output, own[output].versions[0], own, changed)).toBe(false);
    expect(stageHasCurrentDraft(t, entered, output, { content: 'x', created_at: '2026-11-27T15:26:00Z' }, { bundles: own, changedAt: changed })).toBe(true);
  });

  it('nothing before it changed since: the carried text is its draft', () => {
    const older = { [input]: v('2026-11-27T15:00:00Z'), [review]: v('2026-11-27T15:01:00Z'), [output]: v(carried) };
    expect(draftPredatesInputs(t, entered, output, older[output].versions[0], older, changed)).toBe(false);
  });

  it('a reopened or finished stage is left to its recheck; a stage not yet entered is not judged', () => {
    const stale = state({ ...entered.stages, [output]: { status: 'stale', entered_at: '2026-11-27T15:25:40Z', stale: { reason: 'x', since: '', was: 'in_progress' } } } as WorkflowState['stages']);
    expect(draftPredatesInputs(t, stale, output, bundles[output].versions[0], bundles, changed)).toBe(false);
    const done = state({ ...entered.stages, [output]: { status: 'completed', entered_at: '2026-11-27T15:25:40Z' } } as WorkflowState['stages']);
    expect(draftPredatesInputs(t, done, output, bundles[output].versions[0], bundles, changed)).toBe(false);
    const notEntered = state({ ...entered.stages, [output]: { status: 'not_started' } } as WorkflowState['stages']);
    expect(draftPredatesInputs(t, notEntered, output, bundles[output].versions[0], bundles, changed)).toBe(false);
  });

  it('a later stage changing does not count, and without the versions the old rule holds', () => {
    const later = { [input]: v('2026-11-27T15:00:00Z'), [review]: v('2026-11-27T15:01:00Z'), [output]: v(carried), [realign]: v('2026-11-27T15:30:00Z') };
    expect(draftPredatesInputs(t, entered, output, later[output].versions[0], later, changed)).toBe(false);
    expect(stageHasCurrentDraft(t, entered, output, { content: 'old quick answer', created_at: carried })).toBe(true);
  });

  it('with no change to the brief or facts since, a carried answer stays the draft later stages build on (L-123)', () => {
    expect(draftPredatesInputs(t, entered, output, bundles[output].versions[0], bundles, undefined)).toBe(false);
    expect(draftPredatesInputs(t, entered, output, bundles[output].versions[0], bundles, '2026-11-27T15:00:00Z')).toBe(false);
  });

  it('the last change is the user\'s: not a wording edit, nor Go\'s record of a step made before one', () => {
    const ev = (at: string, payload: Record<string, unknown>) => ({ type: 'brief_changed', created_at: at, payload });
    expect(lastBriefChangeAt([ev('2026-11-27T15:10:00Z', { field: 'facts' }), ev('2026-11-27T15:20:00Z', { presentation_only: true }), ev('2026-11-27T15:30:00Z', { made_before_change: true })])).toBe('2026-11-27T15:10:00Z');
    expect(lastBriefChangeAt([{ type: 'stage_version_saved', created_at: '2026-11-27T15:10:00Z', payload: {} }])).toBeUndefined();
  });

  it('a fact added counts by its own time: one added while the first stage was drafted wrote no event', () => {
    expect(lastBriefChangeAt([], [{ created_at: '2026-11-27T21:07:14Z', retired_at: null }])).toBe('2026-11-27T21:07:14Z');
    expect(lastBriefChangeAt([{ type: 'brief_changed', created_at: '2026-11-27T21:20:00Z', payload: {} }], [{ created_at: '2026-11-27T21:07:14Z' }])).toBe('2026-11-27T21:20:00Z');
    expect(lastBriefChangeAt([], [{ created_at: '2026-11-27T21:07:14Z', retired_at: '2026-11-27T21:08:00Z' }])).toBeUndefined();
  });
});
