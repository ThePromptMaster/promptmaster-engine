import { describe, expect, it } from 'vitest';

import { RESEARCH_V1, SINGLE_OUTPUT_V1 } from '@/lib/workflow';
import { initialState } from '@/lib/workflow/engine';
import type { AgentStep } from '@/types/agent';
import { deriveExecutionLabel } from './labels';
import { allowedActions, fitsBudget, noProgress, preempt, shouldPause, stageMoveActor } from './policy';

function step(over: Partial<AgentStep>): AgentStep {
  return {
    id: Math.random().toString(), run_id: 'r', user_id: 'u', project_id: 'p', idx: 0, stage_id: 'experiment',
    mode: 'architect', action_key: 'derive', params: {}, rationale: '', expected_outcome: '', needs_decision: false,
    decision_question: null, status: 'succeeded', execution_label: 'discussed', block_kind: null, tools_used: [],
    changes: {}, output: '', cost_usd: null, started_at: '', finished_at: '', ...over,
  };
}

const research = initialState(RESEARCH_V1);
const base = { state: research, objective: 'Pendulum', stepsUsed: 0, budgetSteps: 5, steps: [] as AgentStep[] };

describe('allowedActions', () => {
  it('offers the research moves only in a research workflow', () => {
    const stage = RESEARCH_V1.stages[0];
    expect(allowedActions(RESEARCH_V1, research, stage, false)).toContain('run_computation');
    const single = initialState(SINGLE_OUTPUT_V1);
    expect(allowedActions(SINGLE_OUTPUT_V1, single, SINGLE_OUTPUT_V1.stages[0], false)).not.toContain('run_computation');
  });

  it('offers drafting to an empty stage and checking/revising to a drafted one', () => {
    const stage = RESEARCH_V1.stages.find((s) => s.renderer === 'prose')!;
    expect(allowedActions(RESEARCH_V1, research, stage, false)).toContain('draft_stage');
    const drafted = allowedActions(RESEARCH_V1, research, stage, true);
    expect(drafted).toEqual(expect.arrayContaining(['evaluate_stage', 'revise_stage']));
    expect(drafted).not.toContain('draft_stage');
  });

  it('always lets the run ask, block or finish', () => {
    expect(allowedActions(RESEARCH_V1, research, RESEARCH_V1.stages[0], false)).toEqual(
      expect.arrayContaining(['mark_blocked', 'request_user_decision', 'declare_objective_complete'])
    );
  });
});

describe('preempt — checked before any model call', () => {
  it('lets a healthy run continue', () => expect(preempt(base)).toBeNull());

  it('stops at the budget', () => {
    expect(preempt({ ...base, stepsUsed: 5 })?.status).toBe('budget_exhausted');
  });

  it('asks for an objective first', () => {
    expect(preempt({ ...base, objective: '  ' })?.status).toBe('awaiting_decision');
  });

  it('respects a blocked stage', () => {
    const cur = research.current_stage_id;
    const blocked = { ...research, stages: { ...research.stages, [cur]: { status: 'blocked' as const, blocked: { kind: 'data_missing' as const, reason: 'no data' } } } };
    expect(preempt({ ...base, state: blocked })).toEqual({ status: 'blocked', reason: 'This stage is blocked: no data. Unblock it, or skip it, to let Go continue.' });
  });

  it('ends a finished project as completed', () => {
    expect(preempt({ ...base, state: { ...research, project_status: 'finalized' } })?.status).toBe('completed');
  });

  it('stops after two failures in a row', () => {
    expect(preempt({ ...base, steps: [step({ status: 'failed' }), step({ status: 'failed' })] })?.status).toBe('failed');
  });

  it('stops a loop making no progress', () => {
    const same = [step({ idx: 0 }), step({ idx: 1 }), step({ idx: 2 })];
    expect(noProgress(same)).toBe(true);
    expect(preempt({ ...base, steps: same })?.status).toBe('blocked');
    expect(noProgress([step({}), step({ action_key: 'prove' }), step({})])).toBe(false);
  });
});

describe('shouldPause — the execution policy, not the model', () => {
  it('Guided pauses before every move', () => {
    expect(shouldPause('guided', 'derive', false)).toBe(true);
  });
  it('Checkpoint pauses before important moves only', () => {
    expect(shouldPause('checkpoint', 'derive', false)).toBe(false);
    expect(shouldPause('checkpoint', 'run_computation', false)).toBe(true);
    expect(shouldPause('checkpoint', 'advance_stage', false)).toBe(true);
  });
  it('Autonomous pauses only when the model asks the user', () => {
    expect(shouldPause('autonomous', 'advance_stage', false)).toBe(false);
    expect(shouldPause('autonomous', 'derive', true)).toBe(true);
  });
  it('the model can escalate but never de-escalate', () => {
    // needs_user_decision=false does not un-important run_computation.
    expect(shouldPause('checkpoint', 'run_computation', false)).toBe(true);
  });
  it('stage moves are the user’s unless an autonomous run acts alone', () => {
    expect(stageMoveActor('checkpoint', true)).toBe('user');
    expect(stageMoveActor('guided', false)).toBe('user');
    expect(stageMoveActor('autonomous', false)).toBe('system');
    expect(stageMoveActor('autonomous', true)).toBe('user');
  });
});

describe('deriveExecutionLabel — PM-12', () => {
  it('reasoning is discussed, writing is designed', () => {
    expect(deriveExecutionLabel('prove', { blocked: false })).toBe('discussed');
    expect(deriveExecutionLabel('draft_stage', { blocked: false })).toBe('designed');
  });
  it('a computation is never more than the sandbox recorded', () => {
    expect(deriveExecutionLabel('run_computation', { blocked: false })).toBe('code_written');
    expect(deriveExecutionLabel('run_computation', { blocked: false, sandboxLabel: 'code_executed' })).toBe('code_executed');
  });
  it('interpretation needs a run to cite', () => {
    expect(deriveExecutionLabel('interpret_result', { blocked: false, interpretedRunId: 'x' })).toBe('result_interpreted');
    expect(deriveExecutionLabel('interpret_result', { blocked: false })).toBe('discussed');
  });
  it('blocked wins, and workflow moves claim nothing', () => {
    expect(deriveExecutionLabel('run_computation', { blocked: true, sandboxLabel: 'code_executed' })).toBe('blocked');
    expect(deriveExecutionLabel('check_literature', { blocked: false })).toBe('blocked');
    expect(deriveExecutionLabel('advance_stage', { blocked: false })).toBeNull();
  });
});

describe('the planner is told which requirements only the user can tick', () => {
  it('marks unmet manual criteria', async () => {
    const { buildAgentState } = await import('./digest');
    const stage = RESEARCH_V1.stages[0];
    const digest = buildAgentState({
      template: RESEARCH_V1, state: research, stage, bundles: {}, steps: [],
      stageEvaluation: {
        stageId: stage.id, canAdvance: false, criteria: [],
        unmet: [
          { id: 'a', label: 'Gap identified', satisfied: false, blocking: true, manual: true },
          { id: 'b', label: 'Two sources', satisfied: false, blocking: true },
        ],
      },
    });
    expect(digest.criteria_unmet).toEqual([
      'Gap identified (ticked by the user when satisfied — revising cannot satisfy it)',
      'Two sources',
    ]);
  });
});

describe('the artifact excerpt fits the backend cap', () => {
  it('a draft over the cap is trimmed to the cap, marker included', async () => {
    const { buildAgentState, ARTIFACT_EXCERPT_CHARS } = await import('./digest');
    const stage = RESEARCH_V1.stages[0];
    const long = 'x'.repeat(20_000);
    const digest = buildAgentState({
      template: RESEARCH_V1, state: research, stage, steps: [],
      bundles: { [stage.id]: { versions: [{ content: long }] } } as never,
      stageEvaluation: { stageId: stage.id, canAdvance: false, criteria: [], unmet: [] },
    });
    expect(digest.artifact_excerpt.length).toBeLessThanOrEqual(ARTIFACT_EXCERPT_CHARS);
    expect(digest.artifact_excerpt.endsWith('[… trimmed …]')).toBe(true);
  });

  it('uses the same cap as AgentState in promptmaster/agent.py', async () => {
    const { ARTIFACT_EXCERPT_CHARS } = await import('./digest');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const py = readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', 'agent.py'), 'utf8');
    const cap = py.match(/artifact_excerpt: str = Field\(default="", max_length=([\d_]+)\)/)?.[1];
    expect(Number(cap?.replace(/_/g, ''))).toBe(ARTIFACT_EXCERPT_CHARS);
  });
});

describe('the budget is a cap', () => {
  it('a computation needs room for its interpretation too', () => {
    expect(fitsBudget('derive', 24, 25)).toBe(true);
    expect(fitsBudget('run_computation', 24, 25)).toBe(false);
    expect(fitsBudget('run_computation', 23, 25)).toBe(true);
  });
});
