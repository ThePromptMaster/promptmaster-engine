import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStageArtifact = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a),
    dependentClaims: async () => ({ claims: [] }),
    checkNewClaims: async () => ({ claims: [] }),
  },
}));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: vi.fn(async () => undefined), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

/**
 * 2 Nov (Sean, photography workshop). He moved the reserve from $400 to $800
 * and every repair of the plan failed: "the new version still states $400
 * (now: "The minimum unspent reserve is $800, replacing $400.")". The $400 in
 * the plan was what is left to spend, $1,200 − $800; the message quoted the
 * fact, so it read as the history line being rejected.
 */
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const OLD_PLAN = [
  '## Reserve check',
  'At least $400 must remain unspent: $1,200 − $400 = $800 to spend.',
  'Spending up to $800 authorized.',
].join('\n');
const NEW_PLAN = [
  '## Reserve check',
  '| Spendable while keeping $800 | $1,200 − $800 = $400 |',
  '| Left for materials | $400 − $300 = $100 |',
  'Spending up to $400 authorized.',
  '## History',
  '- Minimum reserve: $400, replaced by $800.',
].join('\n');

function ctx(): { c: PerformContext; saved: { content: string }[] } {
  const saved: { content: string }[] = [];
  const c = {
    project: {
      id: 'p', user_id: 'u', objective: 'A launch plan for a photography workshop', data_files: [], sources: [], web_access: 'off',
      facts: [{
        id: 'r', project_id: 'p', user_id: 'u', statement: 'The minimum unspent reserve is $800, replacing $400.', subject: null, kind: 'requirement',
        source_kind: 'user_edit', source_ref: {}, accepted_by: 'user', agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null,
        created_at: '2026-11-02T08:48:23Z',
      }],
    },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'summary', stages: { output: { status: 'stale', stale: { reason: 'The reserve changed from $400 to $800.' } } } },
    stage,
    bundles: { output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: OLD_PLAN, finish_reason: 'stop', source_operation: 'agent_revise', created_at: '2026-11-02T08:39:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: 'output' }, rationale: 'Reopened.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    appendStageVersion: async (_id: string, _label: string, v: { content: string }) => {
      saved.push(v);
      return { id: `v${3 + saved.length}` };
    },
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { c, saved };
}

beforeEach(() => generateStageArtifact.mockReset());

describe('a repair whose figures equal an old value (2 Nov, photography workshop)', () => {
  it('is not failed for the $400 it works out from the new $800 reserve', async () => {
    generateStageArtifact.mockResolvedValue({ content: NEW_PLAN, items: [], finish_reason: 'stop', model_used: 'm' });
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(generateStageArtifact).toHaveBeenCalledTimes(1);
    expect(generateStageArtifact.mock.calls[0][0].instruction).toMatch(/happens to equal an old one is not the old value/);
    expect(saved.at(-1)?.content).toContain('Spending up to $400 authorized.');
    expect(out.output).not.toMatch(/still gives|still states/);
  });

  it('still fails for the old reserve, and names the line that states it, then the fact', async () => {
    const kept = NEW_PLAN.replace('Spending up to $400 authorized.', 'Keep a $400 minimum reserve.');
    generateStageArtifact.mockResolvedValue({ content: kept, items: [], finish_reason: 'stop', model_used: 'm' });
    const { c } = ctx();
    const out = await performStep(c);
    // One more try names the line.
    expect(generateStageArtifact).toHaveBeenCalledTimes(2);
    expect(generateStageArtifact.mock.calls[1][0].instruction).toContain('STILL STATED AS CURRENT: $400 in "Keep a $400 minimum reserve."');
    expect(out.status).toBe('failed');
    expect(out.output).toContain('still gives $400 in "Keep a $400 minimum reserve." (the fact now: "The minimum unspent reserve is $800, replacing $400.")');
    expect(out.output).toContain('Lines that record an old value as superseded are history and are kept');
  });
});

describe("a repair holding the model's own working (7 Nov, production)", () => {
  const WORKING = `${NEW_PLAN}\nCorrection to the total line above: $900.`;

  it('is told to take it out, and the clean text is saved', async () => {
    generateStageArtifact.mockResolvedValueOnce({ content: WORKING, items: [], finish_reason: 'stop', model_used: 'm' });
    generateStageArtifact.mockResolvedValue({ content: NEW_PLAN, items: [], finish_reason: 'stop', model_used: 'm' });
    const { c, saved } = ctx();
    await performStep(c);
    expect(generateStageArtifact).toHaveBeenCalledTimes(2);
    expect(generateStageArtifact.mock.calls[1][0].instruction).toContain('YOUR PREVIOUS ATTEMPT LEFT YOUR WORKING IN THE TEXT');
    expect(saved.at(-1)?.content).not.toContain('Correction to the total');
  });

  it('is not saved at all when it comes back with the working still in it', async () => {
    generateStageArtifact.mockResolvedValue({ content: WORKING, items: [], finish_reason: 'stop', model_used: 'm' });
    const { c, saved } = ctx();
    await expect(performStep(c)).rejects.toThrow(/still holds the model's working, so it was not saved/);
    expect(saved).toHaveLength(0);
  });
});

