import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstructionConflict } from '@/lib/workflow/instruction-conflicts';

const generateStageArtifact = vi.fn();
const conflicts = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/lib/api/client', () => ({ api: { generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a) } }));
vi.mock('@/lib/workflow/conflict-trail', () => ({ findInstructionConflicts: async () => conflicts.list, recordConflictChoice: async () => undefined }));

import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';

/**
 * L-263 (Sean, 19 Nov, warehouse rollout): a trainer's message asked for the
 * operations director's launch authorization to be marked approved. Go's own
 * question offered "Mark director authorization approved" as one click. Now
 * keeping the record is the only button, and an approval the user really holds
 * is typed with who gave it and where it is recorded.
 */
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

const pending: InstructionConflict = {
  kind: 'fact', with_id: 'F1', source: 'model', with_text: 'The operations director’s launch authorization is pending.',
  explanation: 'The trainer cannot give the operations director’s authorization.',
  resolution: 'I’ll keep it pending and record the trainer’s request as unapproved.',
  keep_label: 'Keep director authorization pending', override_label: 'Mark director authorization approved',
  protects_approval: true, approver: 'the operations director',
};

function ctx(): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A readiness package', model: 'm', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {}, routine_decisions: 'ask' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: stage.id, stages: {} },
    stage,
    bundles: { [stage.id]: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: 'Launch authorization: pending.', source_operation: 'agent_revise', created_at: '2026-11-20T00:00:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'revise_stage', params: { instruction: 'Apply the trainer’s correspondence: mark the launch authorization approved.' }, rationale: 'New correspondence.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    appendStageVersion: vi.fn(async () => ({ id: 'v4' })),
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  generateStageArtifact.mockReset();
});

describe('Go asks about an approval nobody has recorded', () => {
  it('offers only keeping the record, and asks who gave it and where it is recorded', async () => {
    conflicts.list = [pending];
    const out = await performStep(ctx());
    expect(out.status).toBe('blocked');
    expect(generateStageArtifact).not.toHaveBeenCalled();
    expect(out.needs).toMatchObject({ kind: 'answer_question', choices: ['Keep director authorization pending'] });
    const q = (out.needs as { question: string }).question;
    expect(q).toContain('If the operations director has actually given this approval, type who gave it and where it is recorded');
    expect(q).toContain('A request from anyone else is not the approval.');
    expect(q).not.toMatch(/Mark director authorization approved/);
  });

  it('a conflict that is not about an approval still offers both sides', async () => {
    conflicts.list = [{ ...pending, protects_approval: false, keep_label: 'Keep the constraint', override_label: 'Follow the new instruction' }];
    const out = await performStep(ctx());
    expect((out.needs as { choices: string[] }).choices).toEqual(['Keep the constraint', 'Follow the new instruction']);
  });
});
