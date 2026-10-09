import { describe, expect, it } from 'vitest';

import { EXPLORATION_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, getStage, projectState } from '@/lib/workflow';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState } from '@/lib/workflow/engine';
import type { StageEvaluation } from '@/lib/workflow/types';
import type { AgentStep } from '@/types/agent';
import { deriveExecutionLabel } from './labels';
import { ITEM_SCHEMAS, itemSchemaFor } from '@/lib/workflow/stage-artifact';
import { allowedActions, alternating, unsavedDerivation, saveInsteadOfRepeating, LIVE_TOOLS, NO_TOOLS, polishSinceDirection, withoutOverride, withoutEndlessPolish, withoutSettledRuns, fitsBudget, noChange, noProgress, plannedBeforeLatestChange, preempt, shouldPause, stageMoveActor, stateFingerprint } from './policy';

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

  it('offers Continue writing only on a draft that was cut off (4 Oct)', () => {
    const stage = RESEARCH_V1.stages.find((s) => s.renderer === 'prose')!;
    expect(allowedActions(RESEARCH_V1, research, stage, true, NO_TOOLS, { draft: { truncated: true, checked: false } })).toContain('continue_writing');
    expect(allowedActions(RESEARCH_V1, research, stage, true, NO_TOOLS, { draft: { truncated: false, checked: false } })).not.toContain('continue_writing');
  });

  it('offers drafting to an empty stage and checking/revising to a drafted one', () => {
    const stage = RESEARCH_V1.stages.find((s) => s.renderer === 'prose')!;
    expect(allowedActions(RESEARCH_V1, research, stage, false)).toContain('draft_stage');
    const drafted = allowedActions(RESEARCH_V1, research, stage, true);
    expect(drafted).toEqual(expect.arrayContaining(['evaluate_stage', 'revise_stage']));
    expect(drafted).not.toContain('draft_stage');
  });

  it('always lets the run ask or finish, and block once the stage has been tried', () => {
    const undrafted = allowedActions(RESEARCH_V1, research, RESEARCH_V1.stages[0], false);
    expect(undrafted).toEqual(expect.arrayContaining(['draft_stage', 'request_user_decision', 'declare_objective_complete']));
    // Nothing is stuck before it has been drafted (2 Oct screenshots: an empty
    // review stage was marked stuck for "no draft text" instead of drafted).
    expect(undrafted).not.toContain('mark_blocked');
    expect(allowedActions(RESEARCH_V1, research, RESEARCH_V1.stages[0], true)).toContain('mark_blocked');
  });

  it('a stage that cannot be drafted by Go can still be marked stuck', () => {
    const approval = BOOK_V1.stages.find((s) => s.exit_criteria.some((c) => c.rule?.type === 'outline_approved') && s.renderer !== 'long_form')!;
    expect(allowedActions(BOOK_V1, initialState(BOOK_V1), approval, false)).toContain('mark_blocked');
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
    expect(preempt({ ...base, state: blocked })).toEqual({ status: 'blocked', reason: 'This stage is marked stuck: no data. Clear that, or skip it, to let Go continue.' });
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

  it('the same move that saved a new version each time is work, not a loop (Sean, 4 Oct)', () => {
    const revise = (idx: number, changes: Record<string, unknown>) =>
      step({ idx, action_key: 'revise_stage', execution_label: 'designed', changes });
    const saved = [revise(0, { version_ids: ['v2'] }), revise(1, { version_ids: ['v3'] }), revise(2, { version_ids: ['v4'] })];
    expect(noProgress(saved)).toBe(false);
    // One of the three saved nothing: that is the circle.
    expect(noProgress([saved[0], saved[1], revise(2, {})])).toBe(true);
    // A reasoning move never saves: three of it in a row still stop.
    expect(preempt({ ...base, steps: [0, 1, 2].map((idx) => step({ idx, action_key: 'compare_alternatives' })) })?.reason).toBe(
      '"Compare alternatives" was chosen 3 times in a row on this stage without changing it: none of it was saved to the document. What each produced is in the run log. It needs your direction.'
    );
  });

  it('three repairs of three reopened stages, each saving a version, are progress (production, 7 Oct)', () => {
    const repair = (idx: number, stage: string) =>
      step({ idx, action_key: 'recheck_stage', params: { stage_id: stage }, changes: { version_ids: [`v-${stage}`] } });
    expect(noProgress([repair(0, 'input'), repair(1, 'review'), repair(2, 'output')])).toBe(false);
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
    // A lookup reads an index: it is analysis, not execution — and blocked when it could not run.
    expect(deriveExecutionLabel('check_literature', { blocked: false })).toBe('discussed');
    expect(deriveExecutionLabel('check_literature', { blocked: true })).toBe('blocked');
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

describe('plannedBeforeLatestChange — PM-23, a suggestion about a stage that has since moved on', () => {
  const planned = { started_at: '2026-09-27T10:00:00Z' };
  it('is outdated once a newer version or a newer check exists', () => {
    expect(plannedBeforeLatestChange(planned, ['2026-09-27T10:05:00Z', null])).toBe(true);
    expect(plannedBeforeLatestChange(planned, [null, '2026-09-27T10:05:00Z'])).toBe(true);
  });
  it('is current when everything it read predates it — including the check that led to it', () => {
    expect(plannedBeforeLatestChange(planned, ['2026-09-27T09:00:00Z', '2026-09-27T09:59:59Z'])).toBe(false);
    expect(plannedBeforeLatestChange(planned, [undefined, null])).toBe(false);
    expect(plannedBeforeLatestChange({ started_at: '' }, ['2026-09-27T10:05:00Z'])).toBe(false);
  });
});

describe('B0: the planner sees what exists on outline, long-form and review stages', () => {
  const book = initialState(BOOK_V1);
  const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
  const evaluation = (id: string) => ({ stageId: id, canAdvance: false, criteria: [], unmet: [] });

  it('an outline stage reports its sections and approval, and excerpts titles rather than JSON', async () => {
    const { buildAgentState } = await import('./digest');
    const content = JSON.stringify({ schema: 1, items: [{ id: 'a', title: 'Habitat', abstract: 'Where they live' }, { id: 'b', title: 'Diet', abstract: '' }], orphans: [] });
    const digest = buildAgentState({
      template: BOOK_V1, state: book, stage: stage('outline'), steps: [], stageEvaluation: evaluation('outline'),
      bundles: { outline: { artifact: { id: 'a', stage_id: 'outline', long_form: null }, versions: [{ id: 'v', content }] } } as never,
    });
    expect(digest.outline).toEqual({ sections: ['1. Habitat — Where they live', '2. Diet'], named_count: 2, approved: false });
    expect(digest.artifact_excerpt).toBe('1. Habitat — Where they live\n2. Diet');
    expect(digest.tools).toEqual({ literature: false });
  });

  it('a long-form stage reports the sections written and unwritten — not "(empty)"', async () => {
    const { buildAgentState } = await import('./digest');
    const outline = [
      { id: 's1', title: 'Habitat', status: 'complete', content: 'Giraffes live on the savannah.' },
      { id: 's2', title: 'Diet', status: 'pending', content: '' },
    ];
    const bundles = { drafting: { artifact: { id: 'm', stage_id: 'drafting', long_form: { outline } }, versions: [] } } as never;
    const digest = buildAgentState({
      template: BOOK_V1, state: book, stage: stage('drafting'), steps: [], stageEvaluation: evaluation('drafting'), bundles, pendingJobs: 1,
    });
    expect(digest.manuscript).toEqual({
      total: 2, complete: 1, pending_jobs: 1, written: ['1. Habitat'], unwritten: ['2. Diet'],
      stage_label: 'Drafting', words: 5, own: true, excerpt: '',
    });
    expect(digest.artifact_excerpt).toContain('## 1. Habitat');
    // Revision reads the same manuscript.
    const revision = buildAgentState({
      template: BOOK_V1, state: book, stage: stage('revision'), steps: [], stageEvaluation: evaluation('revision'), bundles,
    });
    expect(revision.manuscript?.complete).toBe(1);
  });

  it('a review stage reports the findings and how many are undecided', async () => {
    const { buildAgentState } = await import('./digest');
    const { serializeItems } = await import('@/lib/workflow/stage-artifact');
    const content = serializeItems([
      { id: 'i1', finding: 'Ch 3 repeats Ch 1', where: 'Ch 3', severity: 'high', status: 'accepted' },
      { id: 'i2', finding: 'Terminology drifts', where: 'Ch 2', severity: 'low' },
    ]);
    const digest = buildAgentState({
      template: BOOK_V1, state: book, stage: stage('continuity'), steps: [], stageEvaluation: evaluation('continuity'),
      bundles: { continuity: { artifact: { id: 'c', stage_id: 'continuity', long_form: null }, versions: [{ id: 'v', content }] } } as never,
    });
    expect(digest.findings).toEqual({ total: 2, triaged: 1, sample: ['Terminology drifts'] });
    expect(digest.artifact_excerpt).toBe('[accepted] Ch 3 repeats Ch 1\n[undecided] Terminology drifts');
  });

  it('a run table is numbered, and with data attached says a computation can carry a row out', async () => {
    const { buildAgentState } = await import('./digest');
    const { serializeItems } = await import('@/lib/workflow/stage-artifact');
    const experiment = RESEARCH_V1.stages.find((s) => s.id === 'experiment')!;
    const content = serializeItems([
      { id: 'r1', run: 'Count the accounts', status: 'not_run', reason: 'No data.', status_source: 'model' },
      { id: 'r2', run: 'Compare cohorts' },
    ]);
    const args = {
      template: RESEARCH_V1, state: research, stage: experiment, steps: [],
      stageEvaluation: { stageId: 'experiment', canAdvance: false, criteria: [], unmet: [] },
      bundles: { experiment: { artifact: { id: 'e', stage_id: 'experiment', long_form: null }, versions: [{ id: 'v', content }] } } as never,
    };
    expect(buildAgentState(args).artifact_excerpt).toBe('1. [not_run] Count the accounts\n2. [undecided] Compare cohorts');
    const withData = buildAgentState({ ...args, dataFiles: [{ name: 'accounts.csv', path: '/data/accounts.csv', kind: 'table', columns: ['id'], sample: [], rows: 3 }] as never });
    expect(withData.artifact_excerpt).toContain('give the row\'s number as `row`');
    expect(withData.artifact_excerpt).toContain('A row no code can carry out is the user\'s to decide.');
  });

  it('a prose stage is unchanged: the head version, no facts', async () => {
    const { buildAgentState } = await import('./digest');
    const digest = buildAgentState({
      template: BOOK_V1, state: book, stage: stage('objective'), steps: [], stageEvaluation: evaluation('objective'),
      bundles: { objective: { artifact: { id: 'o', stage_id: 'objective', long_form: null }, versions: [{ id: 'v', content: 'Why dogs bark.' }] } } as never,
    });
    expect(digest.artifact_excerpt).toBe('Why dogs bark.');
    expect(digest.outline).toBeUndefined();
    expect(digest.manuscript).toBeUndefined();
    expect(digest.findings).toBeUndefined();
  });
});

describe('B0: a move the run cannot perform is not offered', () => {
  it('check_literature is offered only with a literature tool', () => {
    const stage = RESEARCH_V1.stages[0];
    expect(allowedActions(RESEARCH_V1, research, stage, false)).not.toContain('check_literature');
    expect(allowedActions(RESEARCH_V1, research, stage, false, { literature: true })).toContain('check_literature');
  });
});

describe("B2b: the stage's own work is offered only while its preconditions hold", () => {
  const book = initialState(BOOK_V1);
  const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
  const outlineFacts = (namedSections: number) => ({
    outline: { artifact: { id: 'o' }, doc: { schema: 1, items: [], orphans: [] }, head: null, headApproved: false, approved: false, namedSections, unsavedDraft: false },
  }) as never;
  const manuscript = (over: Record<string, unknown>) => ({
    manuscript: {
      artifact: { id: 'm' }, holderStageId: 'drafting', outline: [], total: 2, complete: 0, jobs: [], pendingJobs: [], stopped: [],
      approvedOutlineVersionId: 'ov', brief: null, revisedInStage: 0, ...over,
    },
  }) as never;

  it('generate_outline on a drafting stage that holds a derived outline with nothing in it (1 Oct, item 4)', () => {
    const drafting = RESEARCH_V1.stages.find((s) => s.id === RESEARCH_V1.derived_outline!.stage_id)!;
    expect(allowedActions(RESEARCH_V1, research, drafting, false, undefined, outlineFacts(0))).toContain('generate_outline');
    expect(allowedActions(RESEARCH_V1, research, drafting, false, undefined, outlineFacts(4))).not.toContain('generate_outline');
    // No outline read for the stage: nothing to say about it either way.
    expect(allowedActions(RESEARCH_V1, research, drafting, false)).not.toContain('generate_outline');
  });

  it('generate_outline only on an empty outline stage', () => {
    expect(allowedActions(BOOK_V1, book, stage('outline'), false, undefined, outlineFacts(0))).toContain('generate_outline');
    expect(allowedActions(BOOK_V1, book, stage('outline'), false, undefined, outlineFacts(3))).not.toContain('generate_outline');
    expect(allowedActions(BOOK_V1, book, stage('outline'), false)).not.toContain('generate_outline');
  });

  it('draft_sections needs an approved outline, unwritten sections and no job in flight', () => {
    const drafting = stage('drafting');
    expect(allowedActions(BOOK_V1, book, drafting, false, undefined, manuscript({}))).toContain('draft_sections');
    expect(allowedActions(BOOK_V1, book, drafting, false, undefined, manuscript({ approvedOutlineVersionId: null }))).not.toContain('draft_sections');
    expect(allowedActions(BOOK_V1, book, drafting, false, undefined, manuscript({ complete: 2 }))).not.toContain('draft_sections');
    expect(allowedActions(BOOK_V1, book, drafting, false, undefined, manuscript({ pendingJobs: [{ id: 'j' }] }))).not.toContain('draft_sections');
  });

  it('revise_sections needs a brief, written sections, and a pass not yet done', () => {
    const revision = stage('revision');
    const brief = { stageLabel: 'Revision', instruction: '', findings: [], sources: [] };
    expect(allowedActions(BOOK_V1, book, revision, false, undefined, manuscript({ brief, complete: 2 }))).toContain('revise_sections');
    expect(allowedActions(BOOK_V1, book, revision, false, undefined, manuscript({ brief, complete: 2, revisedInStage: 2 }))).not.toContain('revise_sections');
    expect(allowedActions(BOOK_V1, book, revision, false, undefined, manuscript({ brief, complete: 0 }))).not.toContain('revise_sections');
    // Never draft_sections on a revision stage: the brief says what it is.
    expect(allowedActions(BOOK_V1, book, revision, false, undefined, manuscript({ brief, complete: 1 }))).not.toContain('draft_sections');
  });

  it('apply_findings only when the latest check is about the head and found something', () => {
    const objective = stage('objective');
    expect(allowedActions(BOOK_V1, book, objective, true, undefined, { evaluationFindings: { count: 2, aboutHead: true } })).toContain('apply_findings');
    expect(allowedActions(BOOK_V1, book, objective, true, undefined, { evaluationFindings: { count: 0, aboutHead: true } })).not.toContain('apply_findings');
    expect(allowedActions(BOOK_V1, book, objective, true, undefined, { evaluationFindings: { count: 2, aboutHead: false } })).not.toContain('apply_findings');
    expect(allowedActions(BOOK_V1, book, objective, false, undefined, { evaluationFindings: { count: 2, aboutHead: true } })).not.toContain('apply_findings');
  });
});

describe('B3: triage_findings is offered only while routine rows are undecided', () => {
  const book = initialState(BOOK_V1);
  const continuity = BOOK_V1.stages.find((s) => s.id === 'continuity')!;
  const review = (routine: number, material: number) => ({
    review: { items: [], schema: {}, routine: Array.from({ length: routine }, (_, i) => ({ id: `r${i}` })), material: Array.from({ length: material }, (_, i) => ({ id: `m${i}` })) },
  }) as never;
  it('yes with routine rows; no with only material; no with none', () => {
    expect(allowedActions(BOOK_V1, book, continuity, true, undefined, review(2, 1))).toContain('triage_findings');
    expect(allowedActions(BOOK_V1, book, continuity, true, undefined, review(0, 1))).not.toContain('triage_findings');
    expect(allowedActions(BOOK_V1, book, continuity, true, undefined, {})).not.toContain('triage_findings');
  });
});

describe('a drafted review table is decided, never checked or regenerated by Go (end-to-end pass, 2026-09-29)', () => {
  const book = initialState(BOOK_V1);
  const critique = BOOK_V1.stages.find((s) => s.id === 'critique')!;
  it('offers draft_stage while empty, and no prose moves once drafted', () => {
    expect(allowedActions(BOOK_V1, book, critique, false)).toContain('draft_stage');
    const drafted = allowedActions(BOOK_V1, book, critique, true, undefined, { evaluationFindings: { aboutHead: true, count: 2 } } as never);
    expect(drafted).not.toContain('evaluate_stage');
    expect(drafted).not.toContain('revise_stage');
    expect(drafted).not.toContain('apply_findings');
    expect(drafted).toContain('advance_stage');
  });
});

describe('withoutOverride: only the user moves past something required (1 Oct, item 8)', () => {
  const moves = ['revise_stage', 'advance_stage', 'request_user_decision'];
  it('an autonomous run is not offered the move while a required item is open', () => {
    expect(withoutOverride(moves, false, 'autonomous')).toEqual(['revise_stage', 'request_user_decision']);
    expect(withoutOverride(moves, true, 'autonomous')).toEqual(moves);
  });
  it('under Guided and Checkpoint it is proposed, and the user\'s Approve is the override', () => {
    expect(withoutOverride(moves, false, 'guided')).toEqual(moves);
    expect(withoutOverride(moves, false, 'checkpoint')).toEqual(moves);
  });
});

describe('propose_skip: the order is a default (1 Oct, item 11)', () => {
  it('is offered on a stage the template lets you skip, and not on one it does not', () => {
    const literature = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;
    const method = RESEARCH_V1.stages.find((s) => s.id === 'method')!;
    expect(literature.transitions.allow_skip).toBe(true);
    expect(allowedActions(RESEARCH_V1, research, literature, false)).toContain('propose_skip');
    expect(method.transitions.allow_skip).toBe(false);
    expect(allowedActions(RESEARCH_V1, research, method, false)).not.toContain('propose_skip');
  });
});

describe('withoutOverride: a stage whose requirements are met is not stuck (2 Oct, screenshot 2)', () => {
  const all = ['evaluate_stage', 'advance_stage', 'mark_blocked', 'request_user_decision', 'declare_objective_complete'];

  it('drops the stuck move when the stage can advance, under every policy', () => {
    for (const policy of ['guided', 'checkpoint', 'autonomous'] as const) {
      const kept = withoutOverride(all, true, policy);
      expect(kept).not.toContain('mark_blocked');
      expect(kept).toContain('advance_stage');
    }
  });

  it('keeps the stuck move while something blocking is open', () => {
    expect(withoutOverride(all, false, 'guided')).toContain('mark_blocked');
    // Autonomous may not override, but it may still say it is stuck.
    const autonomous = withoutOverride(all, false, 'autonomous');
    expect(autonomous).toContain('mark_blocked');
    expect(autonomous).not.toContain('advance_stage');
  });

  it('keeps the stuck move on the last stage, where there is nowhere to advance to', () => {
    expect(withoutOverride(['mark_blocked', 'declare_objective_complete'], true, 'guided')).toContain('mark_blocked');
  });
});

describe('a run going round in circles stops (2 Oct, screenshot 7)', () => {
  it('two moves taking turns on one stage is no progress; a third move breaks the pattern', () => {
    const check = (idx: number) => step({ idx, action_key: 'evaluate_stage' });
    const apply = (idx: number) => step({ idx, action_key: 'apply_findings' });
    const circle = [check(0), apply(1), check(2), apply(3), check(4), apply(5)];
    expect(alternating(circle)).toEqual(['evaluate_stage', 'apply_findings']);
    expect(noProgress(circle)).toBe(true);
    expect(preempt({ ...base, steps: circle })?.reason).toBe(
      '"Check this stage" and "Apply the findings" have been taking turns on this stage without it moving on. It needs your direction.'
    );
    // A check, a revision and a second check is ordinary work, not a loop.
    expect(alternating([check(0), apply(1), check(2), apply(3)])).toBeNull();
    expect(alternating([...circle.slice(0, 5), step({ idx: 5, action_key: 'advance_stage' })])).toBeNull();
    // Different stages are different work.
    expect(alternating([check(0), apply(1), check(2), apply(3), { ...check(4), stage_id: 'other' }, apply(5)])).toBeNull();
  });

  it('a fingerprint changes when the project does, and not otherwise', () => {
    const bundles = { experiment: { artifact: null, versions: [{ id: 'v1' }] } } as never;
    const evaluation: StageEvaluation = { stageId: 'experiment', canAdvance: false, criteria: [{ id: 'a', label: 'A', satisfied: false, blocking: true }], unmet: [] };
    const base = { state: research, bundles, events: [1, 2], facts: {}, stageEvaluation: evaluation };
    const same = stateFingerprint(base);
    expect(stateFingerprint({ ...base, facts: {} })).toBe(same);
    expect(stateFingerprint({ ...base, events: [1, 2, 3] })).not.toBe(same);
    expect(stateFingerprint({ ...base, bundles: { experiment: { artifact: null, versions: [{ id: 'v2' }] } } as never })).not.toBe(same);
    expect(stateFingerprint({ ...base, stageEvaluation: { ...evaluation, criteria: [{ id: 'a', label: 'A', satisfied: true, blocking: true }] } })).not.toBe(same);
    expect(stateFingerprint({ ...base, state: { ...research, current_stage_id: 'literature' } })).not.toBe(same);
  });

  it('three performed moves that left the project as it was is a stop, said as what to do', () => {
    expect(noChange(['x', 'x'])).toBeNull();
    expect(noChange(['y', 'x', 'x', 'x'])).toMatch(/^The last 3 moves changed nothing on this stage/);
    expect(noChange(['x', 'x', 'y'])).toBeNull();
  });
});

describe('Go stops polishing a stage that is good enough (production Research pass, 3 Oct)', () => {
  const allowed = ['evaluate_stage', 'apply_findings', 'revise_stage', 'advance_stage', 'request_user_decision'];

  it('keeps polishing while there is room', () => {
    expect(withoutEndlessPolish(allowed, 1, true)).toEqual(allowed);
    expect(withoutEndlessPolish(allowed, 3, false)).toEqual(allowed);
  });

  it('moves on after two polishing moves once the stage can advance', () => {
    expect(withoutEndlessPolish(allowed, 2, true)).toEqual(['advance_stage', 'request_user_decision']);
  });

  it('never polishes one stage more than four times in a run', () => {
    expect(withoutEndlessPolish(allowed, 4, false)).toEqual(['advance_stage', 'request_user_decision']);
  });
});

describe('a computation that settled every run is not run again (production Research pass, 3 Oct)', () => {
  const schema = ITEM_SCHEMAS.runs;
  const allowed = ['run_computation', 'advance_stage'];
  const done = schema.statuses!.find((s) => s.value === 'completed')!.value;

  it('is offered while a planned run has no result', () => {
    expect(withoutSettledRuns(allowed, { schema, items: [{ id: 'a', status: done }, { id: 'b' }] })).toEqual(allowed);
  });

  it('is not offered once every run has one', () => {
    expect(withoutSettledRuns(allowed, { schema, items: [{ id: 'a', status: done }, { id: 'b', status: done }] })).toEqual(['advance_stage']);
  });

  it('counts a computation and its interpretation as one move, not two taking turns', () => {
    const pairs = [1, 2, 3].flatMap(() => [step({ action_key: 'run_computation' }), step({ action_key: 'interpret_result' })]);
    expect(alternating(pairs)).toBeNull();
  });
});

describe('polishSinceDirection: the user asking for a revision restarts the polish count (5 Oct, production)', () => {
  const step = (action_key: string, stage_id = 'literature') => ({ action_key, stage_id });
  const loop = [step('check_literature'), step('revise_stage'), step('check_literature'), step('revise_stage'), step('evaluate_stage'), step('revise_stage'), step('revise_stage')];

  it('counts every polishing move on the stage while the user has said nothing', () => {
    expect(polishSinceDirection(loop, 'literature')).toBe(5);
  });

  it('counts only what came after the user\'s answer', () => {
    expect(polishSinceDirection([...loop, step('user_answer')], 'literature')).toBe(0);
    expect(polishSinceDirection([...loop, step('user_answer'), step('revise_stage')], 'literature')).toBe(1);
  });

  it('counts only this stage', () => {
    expect(polishSinceDirection([step('revise_stage', 'question'), step('revise_stage')], 'literature')).toBe(1);
  });
});

describe('an exploration round ends in a proposed round, not the write-up (production pass, 4 Oct)', () => {
  const ids = EXPLORATION_V1.stages.map((s) => s.id);
  const events = ids.slice(0, ids.indexOf('next_question')).map((id, i) => ({
    type: 'stage_completed' as const, stage_id: id, to_stage_id: ids[i + 1], actor: 'user' as const, created_at: `2026-10-04T00:00:0${i}Z`,
  }));
  const state = projectState(EXPLORATION_V1, events);
  const next = getStage(EXPLORATION_V1, 'next_question')!;

  it('offers the next round and not moving on, once the question is drafted', () => {
    const allowed = allowedActions(EXPLORATION_V1, state, next, true);
    expect(allowed).toContain('propose_next_round');
    expect(allowed).not.toContain('advance_stage');
    expect(allowed).not.toContain('declare_objective_complete');
  });

  it('still lets Go move on from the other stages of a round', () => {
    const findingsState = projectState(EXPLORATION_V1, events.slice(0, ids.indexOf('findings')));
    expect(allowedActions(EXPLORATION_V1, findingsState, getStage(EXPLORATION_V1, 'findings')!, true)).toContain('advance_stage');
  });
});

describe('each exploration round is drafted afresh (production pass, 4 Oct)', () => {
  const ids = EXPLORATION_V1.stages.map((s) => s.id);
  const events = ids.slice(0, ids.indexOf('findings')).map((id, i) => ({
    type: 'stage_completed' as const, stage_id: id, to_stage_id: ids[i + 1], actor: 'user' as const, created_at: `2026-10-04T00:00:0${i}Z`,
  }));
  const state = projectState(EXPLORATION_V1, events);
  const findings = getStage(EXPLORATION_V1, 'findings')!;

  it('drafts a re-entered stage before moving on', () => {
    const allowed = allowedActions(EXPLORATION_V1, state, findings, false);
    expect(allowed).toContain('draft_stage');
    expect(allowed).not.toContain('advance_stage');
  });

  it('moves on once this round has its draft', () => {
    expect(allowedActions(EXPLORATION_V1, state, findings, true)).toContain('advance_stage');
  });
});

describe('the stages of a round stay on their task (production pass, 5 Oct)', () => {
  const ids = EXPLORATION_V1.stages.map((s) => s.id);
  const events = ids.slice(0, ids.indexOf('next_question')).map((id, i) => ({
    type: 'stage_completed' as const, stage_id: id, to_stage_id: ids[i + 1], actor: 'user' as const, created_at: `2026-10-05T00:00:0${i}Z`,
  }));
  const state = projectState(EXPLORATION_V1, events);
  const next = getStage(EXPLORATION_V1, 'next_question')!;

  it('a stage holding last round\'s draft is drafted, nothing else', () => {
    expect(allowedActions(EXPLORATION_V1, state, next, false, LIVE_TOOLS)).toEqual(['draft_stage', 'request_user_decision']);
  });

  it('the stage that closes a round proposes the next one rather than reasoning further', () => {
    const allowed = allowedActions(EXPLORATION_V1, state, next, true, LIVE_TOOLS);
    expect(allowed).toContain('propose_next_round');
    expect(allowed).not.toContain('derive');
    expect(allowed).not.toContain('check_literature');
  });

  it('the other stages of a round may still reason', () => {
    const findingsState = projectState(EXPLORATION_V1, events.slice(0, ids.indexOf('findings')));
    expect(allowedActions(EXPLORATION_V1, findingsState, getStage(EXPLORATION_V1, 'findings')!, true, LIVE_TOOLS)).toContain('derive');
  });
});

describe('R1c: propose_statuses is offered while a check table has rows with neither a decision nor a proposal', () => {
  const alternatives = getStage(RESEARCH_V1, 'alternatives')!;
  const schema = itemSchemaFor(alternatives);
  const facts = (items: { id: string; [k: string]: string }[]) => ({ review: { items, schema, routine: [], material: items, outcome: true } });
  it('offered for an unmarked row, not once every row is proposed or decided', () => {
    expect(allowedActions(RESEARCH_V1, research, alternatives, true, undefined, facts([{ id: 'a', explanation: 'x' }]) as never)).toContain('propose_statuses');
    expect(allowedActions(RESEARCH_V1, research, alternatives, true, undefined, facts([{ id: 'a', explanation: 'x', status: 'ruled_out', status_source: 'proposed' }]) as never)).not.toContain('propose_statuses');
    expect(allowedActions(RESEARCH_V1, research, alternatives, true, undefined, facts([{ id: 'a', explanation: 'x', status: 'ruled_out', status_source: 'user' }]) as never)).not.toContain('propose_statuses');
  });
});

describe('code a deliverable asks to have checked runs in any workflow (M3; Sean, 7 Oct, email 3)', () => {
  it('Single output offers "Run a computation" only when its draft holds code the objective asks to test', () => {
    const output = getStage(SINGLE_OUTPUT_V1, 'output')!;
    const state = initialState(SINGLE_OUTPUT_V1);
    const code = { language: 'python' as const, code: 'print(1)' };
    expect(allowedActions(SINGLE_OUTPUT_V1, state, output, true, LIVE_TOOLS, { code })).toContain('run_computation');
    expect(allowedActions(SINGLE_OUTPUT_V1, state, output, true, LIVE_TOOLS, {})).not.toContain('run_computation');
  });
});

describe('a derivation reaches the document (C4; Sean, 6 Oct, sequence test)', () => {
  const derive = step({ action_key: 'derive', stage_id: 'analysis', status: 'succeeded', output: 'S_n = F_{n+2} - 1, proved by induction.' });
  const saved = step({ action_key: 'revise_stage', stage_id: 'analysis', status: 'succeeded', changes: { version_ids: ['v2'] } });

  it('a derivation not yet saved is what the next revision applies', () => {
    expect(unsavedDerivation([derive], 'analysis')).toEqual({ label: 'Derive', output: 'S_n = F_{n+2} - 1, proved by induction.', action_key: 'derive' });
    expect(unsavedDerivation([derive, saved], 'analysis')).toBeNull();
    expect(unsavedDerivation([derive], 'results')).toBeNull();
  });
});

describe('a repeated derivation is saved, not repeated (9 Oct, production replay)', () => {
  const derive = step({ action_key: 'derive', stage_id: 'analysis', status: 'succeeded', output: 'Binet: a_n = (phi^n - psi^n)/sqrt(5), proved by induction.' });
  it('the same reasoning move again, with its result unsaved, becomes the save', () => {
    const saving = saveInsteadOfRepeating({ action_key: 'derive' }, [derive], 'analysis', ['derive', 'revise_stage'], true);
    expect(saving).toMatchObject({ action_key: 'revise_stage' });
    expect(saving!.params.instruction).toContain('Put the result of the "Derive" step into this stage');
  });
  it('a different reasoning move, no draft, or nothing unsaved: the choice stands', () => {
    expect(saveInsteadOfRepeating({ action_key: 'prove' }, [derive], 'analysis', ['prove', 'revise_stage'], true)).toBeNull();
    expect(saveInsteadOfRepeating({ action_key: 'derive' }, [derive], 'analysis', ['derive', 'revise_stage'], false)).toBeNull();
    expect(saveInsteadOfRepeating({ action_key: 'derive' }, [], 'analysis', ['derive', 'revise_stage'], true)).toBeNull();
  });
});

describe('a repeated derivation on a finished table moves on (9 Oct, production replay)', () => {
  const derive = step({ action_key: 'derive', stage_id: 'experiment', status: 'succeeded', output: 'S_5 = 12 = a_7 - 1.' });
  it('no revision possible, stage ready: the repeat becomes moving on', () => {
    expect(saveInsteadOfRepeating({ action_key: 'derive' }, [derive], 'experiment', ['derive', 'advance_stage'], true, true)).toMatchObject({ action_key: 'advance_stage' });
  });
  it('not ready, or not offered: the choice stands', () => {
    expect(saveInsteadOfRepeating({ action_key: 'derive' }, [derive], 'experiment', ['derive', 'advance_stage'], true, false)).toBeNull();
    expect(saveInsteadOfRepeating({ action_key: 'derive' }, [derive], 'experiment', ['derive'], true, true)).toBeNull();
  });
});

