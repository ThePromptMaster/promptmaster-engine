/**
 * 20 Nov (Sean, warehouse rerun): "Go stopped to ask whether it should remove an
 * internal editing note from the final package. … It seems like routine cleanup Go
 * should handle when it has permission to make routine edits."
 *
 * Go had used its edits on the final package, so it asked: "Should I make one more
 * pass to remove the opening note about the announcement conflict, so the package
 * starts at its title and leaves everything else unchanged?"
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStageArtifact = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...a) } }));
vi.mock('@/lib/workflow/conflict-trail', () => ({ findInstructionConflicts: async () => [], recordConflictChoice: async () => undefined }));

import { asksToRemoveNote, planFromScreen, type QuestionScreen } from './question-screen';
import { performStep, type PerformContext } from './perform';
import { onlyRemoves } from '@/lib/workflow/only-removes';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';

const SEAN = 'Should I make one more pass to remove the opening note about the announcement conflict, so the package starts at its title and leaves everything else unchanged?';
const screen = (over: Partial<QuestionScreen> = {}): QuestionScreen => ({ verdict: 'routine_choice', reason: 'Cleanup.', instruction: '', target_stage: '', action: '', requirement_quote: '', ...over });
const base = { question: SEAN, template: { stages: [] } as never, stage: { transitions: {} } as never, allowed: ['declare_objective_complete'], returnsLeft: 0, editsCapped: true, lastStage: true };

describe('taking out a note to the user is not polishing', () => {
  it('reads a question that asks to take out a note to the user, and nothing else', () => {
    expect(asksToRemoveNote(SEAN)).toBe(true);
    expect(asksToRemoveNote('Remove the internal editing note at the top?')).toBe(true);
    expect(asksToRemoveNote('Should I take out the note to you at the end of the package?')).toBe(true);
    // Content, not a note to the user.
    expect(asksToRemoveNote('Should I remove the budget section?')).toBe(false);
    expect(asksToRemoveNote('Should I remove the note about the warranty terms?')).toBe(false);
    expect(asksToRemoveNote('Should I keep the opening note?')).toBe(false);
  });

  it('one pass past the edit limit, said as such, whatever the screen called it', () => {
    for (const verdict of ['routine_choice', 'routine_repair', 'business_decision'] as const) {
      const plan = planFromScreen(screen({ verdict }), base);
      expect(plan.kind).toBe('repair');
      if (plan.kind !== 'repair') continue;
      expect(plan.move.action_key).toBe('revise_stage');
      expect(plan.move.params.removal_beyond_limit).toBe(true);
      expect(plan.move.rationale).toContain('it only takes out a note to you that is not part of the work');
    }
  });

  it('not a second time, not a reserved approval, and not when the limit was never reached', () => {
    expect(planFromScreen(screen(), { ...base, removalsBeyondLimit: 1 })).toEqual({ kind: 'ask' });
    expect(planFromScreen(screen({ verdict: 'reserved_approval' }), base)).toEqual({ kind: 'ask' });
    const free = planFromScreen(screen(), { ...base, allowed: ['revise_stage'] });
    expect(free.kind === 'repair' && free.move.params.removal_beyond_limit).toBeFalsy();
  });
});

describe('onlyRemoves', () => {
  const doc = 'Note: the stage asks two things.\n\n# Package\n\n## Schedule\n\nTwo sessions run.\n\n## Budget\n\n$11,800.';
  it('holds when lines only went', () => {
    expect(onlyRemoves(doc, '# Package\n\n## Schedule\n\nTwo sessions run.\n\n## Budget\n\n$11,800.')).toBe(true);
  });
  it('fails when a line was reworded, added, moved, or nothing went', () => {
    expect(onlyRemoves(doc, '# Package\n\n## Schedule\n\nTwo sessions will run.\n\n## Budget\n\n$11,800.')).toBe(false);
    expect(onlyRemoves(doc, '# Package\n\n## Budget\n\n$11,800.\n\n## Schedule\n\nTwo sessions run.')).toBe(false);
    expect(onlyRemoves(doc, `${doc}\n\nOne more line.`)).toBe(false);
    expect(onlyRemoves(doc, doc)).toBe(false);
    expect(onlyRemoves(doc, '')).toBe(false);
  });
});

const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const WORK = '# Warehouse Scanner Rollout: Final Readiness Package\n\n## Schedule\n\nTwo sessions run.\n\n## Budget\n\n$11,800 planned.';
const LEAKED =
  'One line on a conflict: the stage asks both to apply the accepted findings and to copy the earlier announcement character for character. ' +
  'I applied i8: I removed both sentences.\n\n' + WORK;
const appendStageVersion = vi.fn(async () => ({ id: 'v9' }));

function ctx(head: string): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A readiness package', model: 'm', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {}, routine_decisions: 'handle' },
    template: SINGLE_OUTPUT_V1,
    state: { current_stage_id: stage.id, stages: {} },
    stage,
    bundles: { [stage.id]: { artifact: null, versions: [{ id: 'v8', version_number: 8, content: head, source_operation: 'agent_apply', created_at: '2026-11-20T12:40:00Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'revise_stage', params: { instruction: 'Take out the note to the user.', removal_beyond_limit: true }, rationale: 'Cleanup.' },
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

describe('the pass itself', () => {
  it('a note the splitter finds comes out in code, with no model call, and nothing else changes', async () => {
    const out = await performStep(ctx(LEAKED));
    expect(out.status).toBe('succeeded');
    expect(generateStageArtifact).not.toHaveBeenCalled();
    const saved = (appendStageVersion.mock.calls[0] as unknown as [string, string, { content: string; change_summary: string }])[2];
    expect(saved.content).toBe(WORK);
    expect(saved.change_summary).toContain('took out a note to you that was not part of the work, and changed nothing else');
    expect(out.output).toContain('Kept out of the document, for you: One line on a conflict');
  });

  it("a model's version that also rewords the work is not saved", async () => {
    const head = `${WORK}\n\nThis paragraph is a note: I kept the earlier wording.`;
    generateStageArtifact.mockResolvedValue({ content: WORK.replace('Two sessions run.', 'Two sessions will run.'), items: [], finish_reason: 'stop', model_used: 'm' });
    const out = await performStep(ctx(head));
    expect(out.status).toBe('failed');
    expect(out.output).toContain('only allowed to take text out');
    expect(appendStageVersion).not.toHaveBeenCalled();
  });

  it("a model's version that only takes the note out is saved", async () => {
    const head = `${WORK}\n\nThis paragraph is a note: I kept the earlier wording.`;
    generateStageArtifact.mockResolvedValue({ content: WORK, items: [], finish_reason: 'stop', model_used: 'm' });
    const out = await performStep(ctx(head));
    expect(out.status).toBe('succeeded');
    expect((appendStageVersion.mock.calls[0] as unknown as [string, string, { content: string }])[2].content).toBe(WORK);
  });
});
