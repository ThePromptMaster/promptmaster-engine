import { describe, expect, it, vi } from 'vitest';

/**
 * 17 Nov (Sean, Hidden Innovation): Go added "Manuscript corrections" and then
 * "Consolidated manuscript". Review went on reading the main manuscript at v1,
 * and the export delivered it. A stage that would only copy or correct the
 * manuscript is refused; the fixes go into the manuscript itself.
 */

const appendWorkflowEvent = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: {} }));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...a), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

const stage = (id: string, renderer: StageDefinition['renderer'], kind = `${id}_text`): StageDefinition => ({
  id, label: id === 'manuscript' ? 'Final academic manuscript' : id, short_label: '', group: 'drafting', required: true, renderer,
  entry_guidance: '', exit_criteria: [], expected_artifacts: [{ kind, cardinality: 'one', primary: true }], recommended_modes: [], skip_reasons: [],
  transitions: { default_next: null, allow_skip: false, allow_return_to: [] },
});
const TEMPLATE = { key: 'custom_hi', stages: [stage('plan', 'prose'), stage('manuscript', 'long_form'), stage('review', 'review', 'critique_report'), stage('memo', 'prose')] } as unknown as WorkflowTemplate;

function ctx(title: string, work: string): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A paper', facts: [], data_files: [], sources: [], web_access: 'off', routine_decisions: 'handle' },
    template: TEMPLATE,
    state: { current_stage_id: 'review', stages: {} },
    stage: TEMPLATE.stages[2],
    bundles: {},
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [], run: { id: 'r', policy: 'autonomous' },
    step: { action_key: 'add_stage', params: { title, work, kind: 'write' }, rationale: 'The fixes need a place.' },
    digest: { recent_steps: [] }, approvedByUser: false, deliverableDone: true,
    afterStageEvent: async () => undefined, loadEvents: async () => [], refresh: async () => undefined,
    appendStageVersion: async () => ({ id: 'v' }),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

describe('a stage that copies the manuscript is not added (17 Nov)', () => {
  it('"Consolidated manuscript" is refused and says where the fixes go', async () => {
    const out = await performStep(ctx('Consolidated manuscript with review fixes', 'One manuscript with every accepted fix in it.'));
    expect(out.status).toBe('failed');
    expect(out.output).toContain('Not added: "Consolidated manuscript with review fixes" would be a second copy of Final academic manuscript.');
    expect(appendWorkflowEvent).not.toHaveBeenCalled();
  });
});
