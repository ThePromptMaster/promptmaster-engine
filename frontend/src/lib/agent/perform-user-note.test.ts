import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStageArtifact = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a) } }));
vi.mock('@/lib/workflow/conflict-trail', () => ({ findInstructionConflicts: async () => [] }));

import { performStep, type PerformContext } from './perform';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';

/**
 * 4 Nov (Sean, Lakeside proposal): Go removed the notes block six times and
 * each revision ended with a new one. What the writer says to the user is the
 * step's reply and the version's record — never saved as the document's end.
 */
const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

const HEAD =
  '## 7. Next step\n\nPlease confirm whether Option B suits you.\n\n&nbsp;\n\nNotes for you, outside the proposal:\n\n' +
  '- Approving the document does not authorise sending it, booking the workshop or spending money.\n' +
  '- No further drafting pass is needed unless you change a fact.';

const appendStageVersion = vi.fn(async () => ({ id: 'v14' }));

function ctx(): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A client proposal', model: 'm', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {} },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: stage.id, stages: {} },
    stage,
    bundles: { [stage.id]: { artifact: null, versions: [{ id: 'v13', version_number: 13, content: HEAD, source_operation: 'agent_revise', created_at: '2026-11-04T12:21:27Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'revise_stage', params: { instruction: 'Delete the notes block after section 7. Change nothing else.' }, rationale: 'The notes must come out.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    appendStageVersion,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  generateStageArtifact.mockReset();
  appendStageVersion.mockClear();
});

describe("a revision's note to the user", () => {
  it('is the reply, not the end of the saved document', async () => {
    generateStageArtifact.mockResolvedValue({
      content: '## 7. Next step\n\nPlease confirm whether Option B suits you.',
      items: [], finish_reason: 'stop', model_used: 'm',
      note_to_user: 'The closing notes are gone; sections 1 to 7 are unchanged.',
    });
    const out = await performStep(ctx());
    expect(out.status).toBe('succeeded');
    const saved = (appendStageVersion.mock.calls[0] as unknown as [string, string, { content: string; change_summary: string }])[2];
    expect(saved.content).toBe('## 7. Next step\n\nPlease confirm whether Option B suits you.');
    expect(saved.change_summary).toContain('Kept out of the document, for you: The closing notes are gone');
    expect(out.output).toContain('Kept out of the document, for you: The closing notes are gone');
  });

  it('written into the end of the text anyway, it is still taken off — and the old one is not put back', async () => {
    generateStageArtifact.mockResolvedValue({
      content:
        '## 7. Next step\n\nPlease confirm whether Option B suits you.\n\n---\n\n*Reply to you, not part of the document:*\n\n' +
        '- The proposal now ends with section 7.\n- Approving the document does not authorise sending it.',
      items: [], finish_reason: 'stop', model_used: 'm',
    });
    const out = await performStep(ctx());
    const saved = (appendStageVersion.mock.calls[0] as unknown as [string, string, { content: string }])[2];
    expect(saved.content).toBe('## 7. Next step\n\nPlease confirm whether Option B suits you.');
    expect(out.output).toContain('Kept out of the document, for you: *Reply to you, not part of the document:*');
  });
});
