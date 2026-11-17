import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 17 Nov (Sean): "a small change [should] get a quick check of the two drafts it
 * affects, while a bigger change gets a deeper review". A save on an earlier
 * stage reopens every finished stage after it; a reopened stage is now checked
 * against what changed before it is rewritten.
 */

const generateStageArtifact = vi.fn();
const assessChange = vi.fn();
const appendWorkflowEvent = vi.fn();
const listWorkflowEvents = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a),
    assessChange: (...a: unknown[]) => assessChange(...a),
    dependentClaims: async () => ({ claims: [] }),
    checkNewClaims: async () => ({ claims: [] }),
  },
}));
vi.mock('@/lib/supabase/workflow', () => ({
  appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...a),
  listWorkflowEvents: (...a: unknown[]) => listWorkflowEvents(...a),
}));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { upstreamChange } from './recheck-first';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

const SINCE = '2026-11-15T01:51:00Z';
const save = (at: string, prior: string, version: string, n: number, affected: string[] = ['realign', 'summary']) => ({
  id: `e${n}`, project_id: 'p', user_id: 'u', seq: n, type: 'stage_version_saved', stage_id: 'output', to_stage_id: null,
  actor: 'system', reason: null, created_at: at, payload: { version_id: version, version_number: n, prior_version_id: prior, affected },
});

function ctx(): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A short book', data_files: [], sources: [], web_access: 'off', facts: [] },
    template: SINGLE_OUTPUT_V1,
    state: {
      current_stage_id: 'summary',
      stages: { realign: { status: 'stale', stale: { reason: 'Output was changed (now v4) after this stage used it.', since: SINCE, was: 'completed_with_artifact' } } },
    },
    stage: SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'summary')!,
    bundles: {
      output: { artifact: null, versions: [
        { id: 'o3', version_number: 3, content: '## Chapter 5: The Growth Story\nText.', source_operation: 'agent_revise', created_at: 't' },
        { id: 'o4', version_number: 4, content: '## Chapter 5: Beyond the Growth Narrative\nText.', source_operation: 'agent_revise', created_at: 't' },
      ] },
      realign: { artifact: { id: 'ar', summary: 'Moves the argument back to the objective: state pensions.' }, versions: [
        { id: 'r2', version_number: 2, content: 'The correction applied: the argument is about pensions.', finish_reason: 'stop', source_operation: 'agent_revise', created_at: 't' },
      ] },
    },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { realign: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: { 'realign.applied': true } },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'realign' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    appendStageVersion: async () => ({ id: 'r3' }),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  for (const f of [generateStageArtifact, assessChange, appendWorkflowEvent, listWorkflowEvents]) f.mockReset();
  listWorkflowEvents.mockResolvedValue([save('2026-11-15T01:51:00Z', 'o3', 'o4', 4)]);
  generateStageArtifact.mockResolvedValue({ content: 'What changed: nothing.\nThe correction applied.', finish_reason: 'stop', model: 'm' });
});

describe('a reopened stage is checked before it is rewritten (17 Nov)', () => {
  it('nothing relied on the change: kept as it is and marked complete again, with no rewrite', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [], calculations_hold: true });
    const out = await performStep(ctx());
    expect(generateStageArtifact).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
    expect(out.changes).toMatchObject({ checked_unchanged: true, stage_closed: true });
    expect(out.output).toBe('Checked Realignment against the change to Output and evaluation (v3 to v4) before rewriting it: nothing in it relied on what changed, so v2 was kept as it is and marked complete again.');
    const sent = assessChange.mock.calls[0][0];
    expect(sent.field).toBe('the earlier stage "Output and evaluation"');
    expect(sent.before).toContain('The Growth Story');
    expect(sent.after).toContain('Beyond the Growth Narrative');
    expect(sent.stages[0]).toMatchObject({ stage_id: 'realign', summary: 'Moves the argument back to the objective: state pensions.' });
    const event = appendWorkflowEvent.mock.calls[0][2];
    expect(event).toMatchObject({ type: 'stage_marked_complete', stage_id: 'realign', actor: 'system', agent_run_id: 'run1' });
    expect(event.payload).toMatchObject({ evidence_version_id: 'r2', checked_unchanged: true });
  });

  it('relied on it: rewritten as before', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [{ stage_id: 'realign', reason: 'It names the chapter.' }], calculations_hold: true });
    await performStep(ctx());
    expect(generateStageArtifact).toHaveBeenCalled();
  });

  it('a check that could not run rewrites as before', async () => {
    assessChange.mockRejectedValue(new Error('down'));
    await performStep(ctx());
    expect(generateStageArtifact).toHaveBeenCalled();
  });
});

describe('which earlier save reopened a stage', () => {
  it('one stage saved twice: the version before the first save and after the last', () => {
    const events = [save('2026-11-15T01:51:00Z', 'o3', 'o4', 4), save('2026-11-15T02:10:00Z', 'o4', 'o5', 5)];
    expect(upstreamChange(SINGLE_OUTPUT_V1, events as never, 'realign', SINCE)).toMatchObject({ stageId: 'output', beforeId: 'o3', afterId: 'o5', beforeNumber: 3, afterNumber: 5 });
  });

  it('two different earlier stages, a save that did not name it, or one before it was reopened: none', () => {
    const other = { ...save('2026-11-15T02:00:00Z', 'i1', 'i2', 2), stage_id: 'review' };
    expect(upstreamChange(SINGLE_OUTPUT_V1, [save(SINCE, 'o3', 'o4', 4), other] as never, 'realign', SINCE)).toBeNull();
    expect(upstreamChange(SINGLE_OUTPUT_V1, [save(SINCE, 'o3', 'o4', 4, ['summary'])] as never, 'realign', SINCE)).toBeNull();
    expect(upstreamChange(SINGLE_OUTPUT_V1, [save('2026-11-14T00:00:00Z', 'o3', 'o4', 4)] as never, 'realign', SINCE)).toBeNull();
  });
});
