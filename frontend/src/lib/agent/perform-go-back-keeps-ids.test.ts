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
 * 9 Nov, production pass: going back to an earlier stage rewrites it, and that path
 * had no ID check. A register's P1 came back as P-1 and was saved.
 */
const REGISTER = '| ID | Finding |\n|---|---|\n| P1 | Orders grew. |\n| P7 | Shipping rose. |\n';
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'summary')!;
const target = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

function ctx(): { c: PerformContext; saved: { content: string }[] } {
  const saved: { content: string }[] = [];
  const c = {
    project: { id: 'p', user_id: 'u', objective: 'A findings register', data_files: [], sources: [], web_access: 'off', facts: [] },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'summary', stages: { output: { status: 'complete' }, summary: { status: 'in_progress' } } },
    stage,
    bundles: {
      output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: REGISTER, finish_reason: 'stop', source_operation: 'agent_revise', created_at: '2026-11-02T09:00:00Z' }], evaluations: {} },
      summary: { artifact: null, versions: [], evaluations: {} },
    },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'return_to_stage', params: { stage_id: target.id, work: 'Add a row.', reason: 'A row is missing.' }, rationale: 'Back.' },
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

describe('going back to rewrite a stage keeps its IDs', () => {
  it('puts a respelled ID back as it was', async () => {
    generateStageArtifact.mockResolvedValue({ content: REGISTER.replace('| P1 |', '| P-1 |'), items: [], finish_reason: 'stop', model_used: 'm' });
    const { c, saved } = ctx();
    await performStep(c);
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toContain('| P1 |');
    expect(saved[0].content).not.toContain('P-1');
  });

  it('does not save a rewrite that renames an ID, and says what happened', async () => {
    generateStageArtifact.mockResolvedValue({ content: REGISTER.replace('| P7 |', '| P7-P |'), items: [], finish_reason: 'stop', model_used: 'm' });
    const { c, saved } = ctx();
    const out = await performStep(c);
    expect(saved).toHaveLength(0);
    expect(out.output).toMatch(/would rename P7 to P7-P/);
    expect(out.output).not.toMatch(/Should those items/);
  });
});
