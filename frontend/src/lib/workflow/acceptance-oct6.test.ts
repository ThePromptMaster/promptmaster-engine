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

import { completionSummary, describeOutstanding, initialState, outstandingBeyondCriteria, outstandingElsewhere, outstandingWork } from './engine';
import { deriveWorkflowRecommendations } from './recommend';
import { evaluateStage } from './engine';
import { SINGLE_OUTPUT_V1 as template } from './templates/single-output.v1';
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
    expect(finish.summary).toContain('Summary: 3 findings not yet accepted or rejected');
  });

  it('Go waiting for the user is outstanding work', () => {
    const items = outstandingWork(template, initialState(template), ctx(), { goWaiting: 'Confirm the 3 proposals on Summary' });
    expect(items.map(describeOutstanding)).toContain('Go is waiting for you: Confirm the 3 proposals on Summary');
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
    expect(summary.outstanding.map(describeOutstanding)).toEqual(['Summary: 1 finding not yet accepted or rejected']);
  });

  it('proposed statuses are counted once, as proposals, not again as open findings', () => {
    const state: WorkflowState = { current_stage_id: 'summary', stages: { summary: { status: 'in_progress' } } };
    const items = outstandingWork(template, state, ctx({ findings: { summary: { total: 3, triaged: 0 } }, itemsProposed: { summary: 3 }, manualChecks: { 'summary.accepted': true } }));
    expect(items.map(describeOutstanding)).toEqual(['Summary: 3 proposed statuses not yet confirmed']);
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
  it.todo('Phase 4: Go repairs a stale stage (recheck_stage), keeps figures that still hold, and re-completes it');
});
describe('Go handles routine repairs within delegated authority', () => {
  it.todo('Phase 4: under "handle them for me", proposed row statuses are confirmed by Go (confirm_proposals)');
});
describe('Accepted evidence is recorded once with its source, and every check reads it', () => {
  it.todo('Phase 3: the facts block appears in every stage, check and chat prompt');
});
