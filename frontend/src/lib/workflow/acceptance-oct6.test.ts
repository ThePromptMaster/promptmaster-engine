/**
 * Sean's acceptance criteria of 6 Oct ("Promptmaster vs cowork", "Additional
 * result from the PromptMaster acceptance test", "Second research test"), as
 * code. One `describe` per criterion; a criterion a later phase builds is
 * `it.todo` until it lands. The scenario is his: one project, 160 staff
 * hours; A (150 h, $60k), B (120 h, $45k), C (80 h, $20k); then "keep one
 * researcher free for client work", which rules A out and makes B the answer.
 *
 * The end-to-end runs are e2e/acceptance-*.spec.ts; the assessment is
 * docs/assessments/2026-10-07-authoritative-state.md.
 */
import { describe, expect, it } from 'vitest';

import { blocksCompletion, completionSummary, describeOutstanding, initialState, outstandingBeyondCriteria, outstandingElsewhere, outstandingWork } from './engine';
import { deriveWorkflowRecommendations } from './recommend';
import { figureFindings, figureSources } from './figure-support';
import { evaluateStage } from './engine';
import { SINGLE_OUTPUT_V1 as template } from './templates/single-output.v1';
import { itemSchemaFor } from './stage-artifact';
import { policyConfirmable, staleRepair } from '@/lib/agent/needs';
import { recheckInstruction } from '@/lib/agent/perform';
import { supersededValues } from './fact-values';
import type { StageContext, WorkflowState } from './types';

const ctx = (over: Partial<StageContext> = {}): StageContext => ({
  fields: { objective: 'Choose one project within 160 staff hours' },
  itemCounts: {},
  itemsMissingStatus: {},
  itemsProposed: {},
  artifactNonEmpty: { input: true, review: true, output: true, summary: true },
  outlineApproved: false,
  sections: {},
  findings: {},
  manualChecks: {},
  ...over,
});

/** Output revised to B after the requirement changed; Summary reopened for a recheck; the user is on Summary. */
const afterChange: WorkflowState = {
  current_stage_id: 'summary',
  stages: {
    input: { status: 'complete' },
    review: { status: 'complete' },
    output: { status: 'complete' },
    realign: { status: 'skipped' },
    summary: { status: 'stale', stale: { reason: 'relied on "highest contribution within capacity"', since: '2026-10-06', was: 'complete' }, },
  },
};

describe('Completion messages agree with unresolved work', () => {
  it('a stage reopened for a recheck is outstanding, whichever stage the user is on', () => {
    const items = outstandingWork(template, afterChange, ctx());
    expect(items.map(describeOutstanding)).toEqual(['Summary needs a recheck — relied on "highest contribution within capacity"']);
    const onOutput = { ...afterChange, current_stage_id: 'output' };
    expect(outstandingElsewhere(outstandingWork(template, onOutput, ctx()), 'output')).toHaveLength(1);
  });

  it('"nothing on it is outstanding" is never said alone while something elsewhere is', () => {
    const state: WorkflowState = { ...afterChange, current_stage_id: 'output' };
    const c = ctx();
    const elsewhere = outstandingElsewhere(outstandingWork(template, state, c), 'output').map(describeOutstanding);
    const [row] = deriveWorkflowRecommendations({
      template, stage: template.stages.find((s) => s.id === 'output')!, evaluation: evaluateStage(template, 'output', c), elsewhere,
    });
    expect(row.summary).not.toMatch(/is outstanding/);
    expect(row.summary).toMatch(/Output and evaluation's required items are done\. One thing is still open: Summary needs a recheck/);
  });

  it('the finish row names what is still open instead of "nothing on it is outstanding"', () => {
    const state: WorkflowState = { ...afterChange, stages: { ...afterChange.stages, summary: { status: 'in_progress' }, output: { status: 'stale', stale: { reason: 'the brief changed', since: 'x', was: 'complete' } } } };
    const c = ctx({ manualChecks: { 'summary.accepted': true } });
    const elsewhere = outstandingElsewhere(outstandingWork(template, state, c), 'summary').map(describeOutstanding);
    const rows = deriveWorkflowRecommendations({ template, stage: template.stages.at(-1)!, evaluation: evaluateStage(template, 'summary', c), elsewhere });
    const finish = rows.find((r) => r.category.startsWith('finish:'))!;
    expect(finish.title).toBe('Close the open item, then finish');
    expect(finish.summary).toContain('Output needs a recheck');
  });

  it('a finding left open on the stage itself is named too, not only work on other stages', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { ...afterChange.stages, summary: { status: 'in_progress' } } };
    const c = ctx({ findings: { summary: { total: 3, triaged: 0 } }, manualChecks: { 'summary.accepted': true } });
    const open = outstandingBeyondCriteria(outstandingWork(template, state, c), 'summary').map(describeOutstanding);
    const rows = deriveWorkflowRecommendations({ template, stage: template.stages.at(-1)!, evaluation: evaluateStage(template, 'summary', c), elsewhere: open });
    const finish = rows.find((r) => r.category.startsWith('finish:'))!;
    expect(finish.summary).not.toMatch(/nothing on it/);
    expect(finish.summary).toContain('Summary: 3 optional findings not yet accepted or rejected');
  });

  it('Go waiting for the user is outstanding work', () => {
    const items = outstandingWork(template, initialState(template), ctx(), { goWaiting: 'Confirm the 3 proposals on Summary' });
    expect(items.map(describeOutstanding)).toContain('Go is waiting for you: Confirm the 3 proposals on Summary');
  });
});

describe('A finished cycle with an unmet objective stays paused on its blocker (email 13)', () => {
  it('a "not met" objective is outstanding, with what it waits for, even when every stage is done', () => {
    const done: WorkflowState = { current_stage_id: 'summary', stages: { input: { status: 'complete' }, review: { status: 'complete' }, output: { status: 'complete' }, realign: { status: 'skipped' }, summary: { status: 'complete' } } };
    const items = outstandingWork(template, done, ctx({ manualChecks: { 'summary.accepted': true } }), {
      objectiveUnmet: { blockers: ['the exact formulas and their parameterisation'] },
    });
    expect(items.map(describeOutstanding)).toEqual(['The objective is not met — waiting for: the exact formulas and their parameterisation']);
  });
});

describe('The project cannot report "Ready to move on" while an unresolved check remains', () => {
  it('an unresolved finding counts even when the template marks it non-blocking', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { ...afterChange.stages, summary: { status: 'in_progress' } } };
    const c = ctx({ findings: { summary: { total: 4, triaged: 3 } }, manualChecks: { 'summary.accepted': true } });
    // The stage's own gate is satisfied…
    expect(evaluateStage(template, 'summary', c).canAdvance).toBe(true);
    // …but the finding is outstanding, and finishing is no longer plain "Finish project".
    const summary = completionSummary(template, state, c);
    expect(summary.outstanding.map(describeOutstanding)).toEqual(['Summary: 1 optional finding not yet accepted or rejected']);
  });

  it('proposed statuses are counted once, as proposals, not again as open findings', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { summary: { status: 'in_progress' } } };
    const items = outstandingWork(template, state, ctx({ findings: { summary: { total: 3, triaged: 0 } }, itemsProposed: { summary: 3 }, manualChecks: { 'summary.accepted': true } }));
    expect(items.map(describeOutstanding)).toEqual(['Summary: 3 optional proposed statuses not yet confirmed']);
  });

  it('optional rows are listed but hold nothing up; a row saying a requirement is unmet does (C2/C3, 8 Oct)', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { ...afterChange.stages, summary: { status: 'in_progress' } } };
    const optional = outstandingWork(template, state, ctx({ findings: { summary: { total: 3, triaged: 0 } }, manualChecks: { 'summary.accepted': true } }));
    expect(optional.every((i) => !blocksCompletion(i))).toBe(true);
    const unmet = outstandingWork(template, state, ctx({ findings: { summary: { total: 3, triaged: 0 } }, openUnmet: { summary: 1 }, manualChecks: { 'summary.accepted': true } }));
    expect(unmet.map(describeOutstanding)).toEqual(['Summary: 1 finding not yet accepted or rejected', 'Summary: 2 optional findings not yet accepted or rejected']);
    expect(unmet.filter(blocksCompletion)).toHaveLength(1);
    const carried = outstandingWork(template, state, ctx({ carriedForward: { summary: ['Proofs missing from the report'] }, manualChecks: { 'summary.accepted': true } }));
    expect(carried.map(describeOutstanding)).toEqual(['Summary: carried forward, still unmet — "Proofs missing from the report"']);
    expect(carried.filter(blocksCompletion)).toHaveLength(1);
  });

  it('a clean project has nothing outstanding', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { ...afterChange.stages, summary: { status: 'in_progress' } } };
    expect(outstandingWork(template, state, ctx({ findings: { summary: { total: 2, triaged: 2 } }, manualChecks: { 'summary.accepted': true } }))).toEqual([]);
  });
});

describe('An authorized requirement change updates the brief and affected artifacts', () => {
  it.todo('Phase 3: a requirement or fact recorded in project_facts reopens only the stages that relied on it');
});
describe('Superseded recommendations are repaired consistently; valid figures remain', () => {
  it('a stage reopened by the change is Go\'s next move, earliest first, at most twice per run', () => {
    const state: WorkflowState = { ...afterChange, stages: { ...afterChange.stages, output: { status: 'stale', stale: { reason: 'the requirement changed', since: 'x', was: 'complete' } } } };
    expect(staleRepair(template, state)).toMatchObject({ key: 'recheck_stage', params: { stage_id: 'output' } });
    // A repair that failed is tried once more (D2, 8 Oct), then left to the user.
    expect(staleRepair(template, state, ['output'])).toMatchObject({ params: { stage_id: 'output' } });
    expect(staleRepair(template, state, ['output', 'output'])).toMatchObject({ params: { stage_id: 'summary' } });
    expect(staleRepair(template, state, ['output', 'output', 'summary', 'summary'])).toBeNull();
  });
  it('a stage a change reopened after the current one is repaired too, through to the final bundle (8 Oct, TeamNotes)', () => {
    const changed = { status: 'stale' as const, stale: { reason: 'the launch date changed', since: 'x', was: 'complete' as const } };
    const atOutput: WorkflowState = { ...afterChange, current_stage_id: 'output', stages: { ...afterChange.stages, output: changed, summary: changed } };
    expect(staleRepair(template, atOutput, ['output', 'output'])).toMatchObject({ params: { stage_id: 'summary' } });
  });
  it('a stage after the one the project is on is redone in order, not repaired ahead of it', () => {
    const back: WorkflowState = { ...afterChange, current_stage_id: 'review', stages: { ...afterChange.stages, review: { status: 'in_progress' }, output: { status: 'stale', stale: { reason: 'went back', since: 'x', was: 'complete' } } } };
    expect(staleRepair(template, back)).toBeNull();
  });
  it('the repair is told to keep what holds and replace what the change superseded', () => {
    const text = recheckInstruction('Output', 'relied on "highest contribution within capacity"');
    expect(text).toContain('Keep every figure, calculation and finding that still holds, exactly as written');
    expect(text).toContain('one that no longer qualifies is said to be excluded, and why');
    expect(text).toContain('"What changed:"');
    // D2 (8 Oct): a changed fact's old value is named, with what replaces it.
    const withChange = recheckInstruction('Announcement', 'the launch date changed', supersededValues('Launch: November 12, 2026', 'Launch: November 19, 2026'));
    expect(withChange).toContain('CHANGED FACTS');
    expect(withChange).toContain('November 12 (was: "Launch: November 12, 2026"; now: "Launch: November 19, 2026")');
  });
});
describe('Go handles routine repairs within delegated authority', () => {
  const summary = template.stages.find((s) => s.id === 'summary')!;
  const schema = itemSchemaFor(summary);
  const rows = [
    { id: 'i1', text: 'B fits within 160 hours', status: 'accepted', status_source: 'proposed', reason: 'says so' },
    { id: 'i2', text: 'C qualifies but contributes less', status: 'deferred', status_source: 'proposed', reason: 'kept as an option' },
    { id: 'i3', text: 'Unclear' },
  ];
  const facts = { review: { items: rows, schema, routine: [], material: rows, outcome: true } } as never;
  it('under "handle them for me", proposals that stand are Go\'s to confirm; under "ask me" they are not', () => {
    expect(policyConfirmable(summary, facts, 'handle')).toBe(2);
    expect(policyConfirmable(summary, facts, 'ask')).toBe(0);
  });
  it('not where the rows are a decision reserved to the user', () => {
    const reserved = { ...summary, exit_criteria: [{ id: 'x', label: 'I accept each verdict', check: 'manual' as const, blocking: true, authority: 'reserved' as const }] };
    expect(policyConfirmable(reserved, facts, 'handle')).toBe(0);
  });
});
describe('Accepted evidence is recorded once with its source, and every check reads it', () => {
  it('a figure the user supplied as an accepted fact is supplied material for the figure check', () => {
    const fact = { id: 'f', project_id: 'p', user_id: 'u', statement: 'Candidate A saved $4.5m in year one', subject: null, kind: 'fact' as const,
      source_kind: 'chat' as const, source_ref: {}, accepted_by: 'user' as const, agent_run_id: null, supersedes: null, retired_at: null, retired_reason: null, created_at: '' };
    const sources = figureSources({ objective: 'o', constraints: '', audience: '', output_format: '', context: '', data_files: [], facts: [fact] }, {}, 'summary');
    expect(figureFindings('A is recommended: $4.5m saved in year one.', sources)).toEqual([]);
  });
  // The rest is held elsewhere: every prompt carries the same facts block
  // (backend/tests/test_project_facts.py); the record, its source and its
  // history, and the change check on it (e2e/facts.spec.ts).
});
