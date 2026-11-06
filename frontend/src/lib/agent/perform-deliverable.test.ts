import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentAssessObjective = vi.fn();
const agentCheckDeliverable = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    agentAssessObjective: (...a: unknown[]) => agentAssessObjective(...a),
    agentCheckDeliverable: (...a: unknown[]) => agentCheckDeliverable(...a),
  },
}));
const appendWorkflowEvent = vi.fn(async () => undefined);
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...(a as [])), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));
const CHAPTERS = { id: 'a1', stage_id: 'manuscript', long_form: { outline: [{ id: 's1', title: 'Chapter 4', status: 'complete', content: `Sam approves 2:30. ${Array.from({ length: 300 }, () => 'word').join(' ')}` }] } };
vi.mock('@/lib/supabase/versions', () => ({
  getArtifact: vi.fn(async () => CHAPTERS),
  listVersions: vi.fn(async () => []),
  listArtifacts: vi.fn(async () => []),
}));

import { performStep, type PerformContext } from './perform';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/**
 * 5 Nov (a six-chapter book test): the check judged the chapters while the review's
 * corrections were in the finished stage, and each repair reopened the chapters.
 */
const stage = (id: string, label: string, renderer: string) => ({ id, label, short_label: label, required: true, renderer, exit_criteria: [], expected_artifacts: [], transitions: { default_next: null, allow_skip: false, allow_return_to: [] } });
const template = { key: 'custom_book', stages: [stage('manuscript', 'Manuscript', 'long_form'), stage('finished', 'Finished book', 'prose')] } as unknown as WorkflowTemplate;
const FINISHED = `Sam approves 2pm on three conditions. ${Array.from({ length: 300 }, () => 'word').join(' ')}`;

function ctx(finished: string | null): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A book', facts: [], data_files: [], sources: [], web_access: 'off' },
    template,
    state: { current_stage_id: 'finished', stages: { manuscript: { status: 'complete' }, finished: { status: 'in_progress' } } },
    stage: template.stages[1],
    bundles: {
      manuscript: { artifact: CHAPTERS, versions: [] },
      finished: { artifact: null, versions: finished ? [{ id: 'f9', version_number: 9, content: finished, source_operation: 'agent_revise', created_at: '2026-11-05T23:44:00Z' }] : [] },
    },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { finished: Boolean(finished) }, outlineApproved: true, sections: { manuscript: { total: 1, complete: 1 } }, findings: {}, manualChecks: {}, measured: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'declare_objective_complete', params: {}, rationale: 'Done.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: true,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  agentAssessObjective.mockReset();
  agentCheckDeliverable.mockReset();
  appendWorkflowEvent.mockClear();
  agentCheckDeliverable.mockResolvedValue({ findings: [], contradictions: [] });
  agentAssessObjective.mockResolvedValue({
    outcome: 'not_met', reason: 'No.', basis_quote: '', blockers: [], performed: [], proposed_next: [],
    criteria: [{ requirement: 'A note on this text', verdict: 'not_met', basis: 'No.' }], model_used: 'm',
  });
});

describe('the objective check reads the text the project delivers', () => {
  it('the finished stage, when it holds the work, and its verdict says so', async () => {
    const out = await performStep(ctx(FINISHED));
    const [req] = agentAssessObjective.mock.calls[0] as [{ content: string; deliverable_label: string }];
    expect(req.content).toContain('Sam approves 2pm');
    expect(req.content).not.toContain('Sam approves 2:30');
    expect(req.deliverable_label).toBe('Finished book');
    expect(agentCheckDeliverable.mock.calls[0][0].content).toContain('Sam approves 2pm');
    const judged = appendWorkflowEvent.mock.calls.map((c) => (c as unknown[])[2] as { type: string; payload: { basis: { stage_id: string; version_id: string } } }).find((e) => e.type === 'objective_assessed')!;
    expect(judged.payload.basis).toMatchObject({ stage_id: 'finished', version_id: 'f9', version_number: 9 });
    // "Have Go fix it" then reopens what was judged.
    expect(out.needs).toMatchObject({ kind: 'objective_check', stageId: 'finished', finding: 'unmet' });
  });

  it('the chapters, read now, before the finished stage is written, naming no version that is not that text', async () => {
    await performStep(ctx(null));
    const [req] = agentAssessObjective.mock.calls[0] as [{ content: string }];
    expect(req.content).toContain('Sam approves 2:30');
    const judged = appendWorkflowEvent.mock.calls.map((c) => (c as unknown[])[2] as { type: string; payload: { basis: { stage_id: string; version_id: string | null } } }).find((e) => e.type === 'objective_assessed')!;
    expect(judged.payload.basis).toMatchObject({ stage_id: 'manuscript', version_id: null });
  });
});
