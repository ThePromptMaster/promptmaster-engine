import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentAssessObjective = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    agentAssessObjective: (...a: unknown[]) => agentAssessObjective(...a),
    agentCheckDeliverable: async () => ({ findings: [], contradictions: [], read_chars: 100, total_chars: 100 }),
  },
}));
const appendWorkflowEvent = vi.fn(async () => undefined);
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...(a as [])), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { FIX_OBJECTIVE_REASON } from './objective-fixes';
import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';

const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

function ctx(events: { type: string; reason?: string; created_at: string }[]): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A short report', facts: [], data_files: [], sources: [], web_access: 'off' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: 'output', stages: { output: { status: 'in_progress' } } },
    stage,
    bundles: { output: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: 'The report as it stands.', source_operation: 'agent_revise', created_at: '2026-11-05T23:00:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { output: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {}, measured: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'declare_objective_complete', params: {}, rationale: 'Done.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: true,
    afterStageEvent: async () => undefined,
    loadEvents: async () => events,
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

const fix = (minute: number) => ({ type: 'brief_changed', reason: FIX_OBJECTIVE_REASON, created_at: `2026-11-05T23:0${minute}:00Z` });

beforeEach(() => {
  agentAssessObjective.mockReset();
  appendWorkflowEvent.mockClear();
  agentAssessObjective.mockResolvedValue({
    outcome: 'not_met', reason: 'The note describes an older draft.', basis_quote: '', blockers: [], performed: [], proposed_next: [],
    criteria: [{ requirement: 'A note on this text', verdict: 'not_met', basis: 'It describes an older draft.' }],
    read_chars: 24, total_chars: 24, model_used: 'm',
  });
});

describe('the check that is still unmet after Go has tried twice', () => {
  it('after one repair it still offers to fix it', async () => {
    const out = await performStep(ctx([fix(1)]));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'unmet' });
  });

  it('after two it does not', async () => {
    const out = await performStep(ctx([fix(1), fix(2)]));
    expect(out.needs).toMatchObject({ kind: 'objective_check', finding: 'repair_limit', tried: 2, items: [expect.stringContaining('A note on this text')] });
    expect(out.stop?.status).toBe('awaiting_decision');
  });

  it('records which text was read and how much of it, with the verdict', async () => {
    await performStep(ctx([]));
    const [, , event] = appendWorkflowEvent.mock.calls.find((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { type: string }).type === 'objective_assessed') as unknown as [string, string, { payload: { basis: unknown } }];
    expect(event.payload.basis).toMatchObject({ stage_id: 'output', version_number: 3, read: { chars: 24, total: 24 } });
  });
});
