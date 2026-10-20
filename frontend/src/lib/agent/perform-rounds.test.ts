import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendWorkflowEvent = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
const agentAssessObjective = vi.fn();
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...a), listWorkflowEvents: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { agentAssessObjective: (...a: unknown[]) => agentAssessObjective(...a) } }));

import { performStep, type PerformContext } from './perform';
import { EXPLORATION_V1 } from '@/lib/workflow';

/**
 * 19 Oct (HARBOR): nine full rounds under "Handle them for me" with nothing
 * new between them, and the package after the round never written. The
 * performer of "Suggest the next round", with the database and model mocked.
 */
const stage = EXPLORATION_V1.stages.find((s) => s.transitions.loop_to)!;
const goRound = (at: string) => ({ type: 'stage_returned', stage_id: stage.id, actor: 'system', payload: { next_round: true }, created_at: at });

function ctx(events: unknown[], project: Record<string, unknown> = {}): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'An idea', routine_decisions: 'handle', facts: [], data_files: [], ...project },
    template: EXPLORATION_V1,
    state: { current_stage_id: stage.id, stages: {} },
    stage,
    bundles: { [stage.id]: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: 'The next question.' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: { [stage.id]: true }, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'propose_next_round', params: {}, rationale: 'Worth another round.' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    afterStageEvent: async () => undefined,
    loadEvents: async () => events,
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  appendWorkflowEvent.mockClear();
  agentAssessObjective.mockReset();
  agentAssessObjective.mockResolvedValue({ outcome: 'not_met', reason: 'Not there yet.', basis_quote: '', blockers: [], performed: [], proposed_next: [] });
});

describe('Go and the rounds of ongoing work', () => {
  it('starts another round while it has started fewer than two since anything new arrived', async () => {
    const out = await performStep(ctx([goRound('2026-10-19T10:00:00Z')]));
    const types = appendWorkflowEvent.mock.calls.map((c) => (c[2] as { type: string }).type);
    expect(types).toEqual(['objective_assessed', 'stage_returned']);
    expect(out.output).toContain('Started the next round');
  });

  it('after two rounds with nothing new, moves on to the stage after the round instead of a third', async () => {
    const out = await performStep(ctx([goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')]));
    expect(agentAssessObjective).not.toHaveBeenCalled();
    const [[, , event]] = appendWorkflowEvent.mock.calls as unknown as [string, string, { type: string; to_stage_id: string; payload: Record<string, unknown> }][];
    expect(['stage_marked_complete', 'stage_advanced']).toContain(event.type);
    expect(event.to_stage_id).toBe(stage.transitions.default_next);
    expect(event.payload.rounds_closed).toBe(2);
    expect(out.status).toBe('succeeded');
    expect(out.output).toContain('Go has run 2 rounds since anything new reached the project');
  });

  it('a data file added since the rounds began lets another round start', async () => {
    await performStep(ctx([goRound('2026-10-19T10:00:00Z'), goRound('2026-10-19T11:00:00Z')], { data_files: [{ created_at: '2026-10-19T10:30:00Z' }] }));
    const types = appendWorkflowEvent.mock.calls.map((c) => (c[2] as { type: string }).type);
    expect(types).toContain('stage_returned');
  });

  // 19 Oct (HARBOR): the round check said "not met" only because the package
  // stage after the round had not run yet.
  it('a round whose only gap is the stage after it moves on at once, with the check told which stage that is', async () => {
    agentAssessObjective.mockResolvedValue({
      outcome: 'not_met', reason: 'Nothing in this work is left for you: Write-up writes the deliverable next.', basis_quote: '',
      blockers: [], performed: [], proposed_next: [], ready_for_later_stage: true,
    });
    const out = await performStep(ctx([]));
    const next = EXPLORATION_V1.stages.find((s) => s.id === stage.transitions.default_next)!;
    expect(agentAssessObjective.mock.calls[0][0]).toMatchObject({ later_stage: next.label, known_versions: { [stage.short_label]: 3 } });
    const types = appendWorkflowEvent.mock.calls.map((c) => (c[2] as { type: string }).type);
    expect(types[0]).toBe('objective_assessed');
    expect(['stage_marked_complete', 'stage_advanced']).toContain(types[1]);
    expect(types).not.toContain('stage_returned');
    expect(out.output).toContain(`Moving on to ${next.label} instead of another round.`);
  });
});

