import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 17 Nov (Sean): "a small change [should] get a quick check of the two drafts it
 * affects, while a bigger change gets a deeper review". A change to an earlier
 * stage reopens every finished stage after it; a reopened stage is now checked
 * against what changed before it is rewritten.
 */

const generateStageArtifact = vi.fn();
const assessChange = vi.fn();
const appendWorkflowEvent = vi.fn();
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
  listWorkflowEvents: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { upstreamChanges } from './recheck-first';
import { assertHonestOutcome } from './outcome';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

const SINCE = '2026-11-15T01:51:00Z';
const v = (id: string, n: number, content: string, created_at: string) => ({ id, version_number: n, content, source_operation: 'agent_revise', created_at, finish_reason: 'stop' });

function bundles(output = [v('o3', 3, '## Chapter 5: The Growth Story\nText.', '2026-11-14T00:00:00Z'), v('o4', 4, '## Chapter 5: Beyond the Growth Narrative\nText.', '2026-11-15T01:52:00Z')]) {
  return {
    input: { artifact: null, versions: [v('i1', 1, 'The brief.', '2026-11-01T00:00:00Z')] },
    output: { artifact: null, versions: output },
    realign: { artifact: { id: 'ar', summary: 'Moves the argument back to the objective: state pensions.' }, versions: [v('r2', 2, 'The correction applied: the argument is about pensions.', '2026-11-14T01:00:00Z')] },
  };
}

function ctx(b = bundles()): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A short book', data_files: [], sources: [], web_access: 'off', facts: [] },
    template: SINGLE_OUTPUT_V1,
    state: {
      current_stage_id: 'summary',
      stages: { realign: { status: 'stale', stale: { reason: 'Output was changed (now v4) after this stage used it.', since: SINCE, was: 'completed_with_artifact' } } },
    },
    stage: SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'summary')!,
    bundles: b,
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
  for (const f of [generateStageArtifact, assessChange, appendWorkflowEvent]) f.mockReset();
  generateStageArtifact.mockResolvedValue({ content: 'What changed: nothing.\nThe correction applied.', finish_reason: 'stop', model: 'm' });
});

describe('a reopened stage is checked before it is rewritten (17 Nov)', () => {
  it('nothing relied on the change: kept as it is and marked complete again, with no rewrite', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [], calculations_hold: true });
    const out = await performStep(ctx());
    expect(generateStageArtifact).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
    expect(out.changes).toMatchObject({ checked_unchanged: true, stage_closed: true, event_types: ['stage_marked_complete'] });
    expect(assertHonestOutcome('recheck_stage', out).status).toBe('succeeded');
    expect(out.output).toBe('Checked Realignment against the change to Output and evaluation (v3 to v4) before rewriting it: nothing in it relied on what changed, so v2 was kept as it is and marked complete again.');
    const sent = assessChange.mock.calls[0][0];
    // The brief's fields only in `field`; the stage is named in `label` (17 Nov, production: a 422).
    expect(sent.field).toBe('earlier_stage');
    expect(sent.label).toBe('the earlier stage "Output and evaluation"');
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

  it('nothing earlier changed (a brief change reopened it): no check, rewritten as before', async () => {
    const same = bundles([v('o3', 3, 'Same.', '2026-11-14T00:00:00Z')]);
    await performStep(ctx(same));
    expect(assessChange).not.toHaveBeenCalled();
    expect(generateStageArtifact).toHaveBeenCalled();
  });
});

describe('what changed before a reopened stage', () => {
  it('each earlier stage whose text then and now differ, from the last version before the reopening', () => {
    const b = bundles([v('o3', 3, 'old', '2026-11-14T00:00:00Z'), v('o4', 4, 'mid', '2026-11-15T02:00:00Z'), v('o5', 5, 'new', '2026-11-15T03:00:00Z')]);
    expect(upstreamChanges(SINGLE_OUTPUT_V1, b as never, 'realign', SINCE)).toEqual([
      { stageId: 'output', label: 'Output and evaluation', before: { id: 'o3', number: 3, content: 'old' }, after: { id: 'o5', number: 5, content: 'new' } },
    ]);
  });

  it('a user who went back and edited an earlier stage: the same comparison (Sean, 17 Nov: "go back and change things")', () => {
    const b = bundles();
    b.input.versions.push(v('i2', 2, 'The brief, with one more sentence.', '2026-11-15T01:55:00Z'));
    const out = upstreamChanges(SINGLE_OUTPUT_V1, b as never, 'realign', SINCE);
    expect(out?.map((c) => c.stageId)).toEqual(['input', 'output']);
  });

  it('saved again with the same text: no change', () => {
    const b = bundles([v('o3', 3, 'same', '2026-11-14T00:00:00Z'), v('o4', 4, 'same', '2026-11-15T02:00:00Z')]);
    expect(upstreamChanges(SINGLE_OUTPUT_V1, b as never, 'realign', SINCE)).toEqual([]);
  });

  it('an earlier stage first written after the reopening cannot be compared', () => {
    const b = bundles([v('o1', 1, 'new', '2026-11-15T02:00:00Z')]);
    expect(upstreamChanges(SINGLE_OUTPUT_V1, b as never, 'realign', SINCE)).toBeNull();
  });
});

describe('the save that reopens a stage lands before the event that says so (17 Nov, production pass)', () => {
  it('a brief edited at 17:31:40.9 and the stages reopened at 17:31:41.2: the edit is still the change', () => {
    const b = bundles();
    b.input.versions.push(v('i2', 2, 'The brief, with the revision log line.', '2026-11-17T17:31:40.941Z'));
    // The realignment was written on 14 Nov, against the brief's v1.
    const out = upstreamChanges(SINGLE_OUTPUT_V1, b as never, 'realign', '2026-11-14T01:00:00Z');
    expect(out?.map((c) => `${c.stageId} v${c.before.number}→v${c.after.number}`)).toEqual(['input v1→v2', 'output v3→v4']);
  });
});
