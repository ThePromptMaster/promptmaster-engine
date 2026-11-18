import { describe, expect, it } from 'vitest';

import { carriedKeys, carryThisRun, copiesTheManuscript, fixesToCarry, GO_CARRY_ROUNDS, loneManuscript } from './manuscript-fixes';
import { repairTries, staleRepair } from './needs';
import { acceptedRowsBefore } from './deliverable-check';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

/**
 * 17 Nov (Sean, Hidden Innovation): the review after the manuscript accepted
 * fixes that never reached the manuscript; Go made a "Manuscript corrections"
 * stage and a "Consolidated manuscript" instead, and Review read the old v1.
 */

const stage = (id: string, renderer: StageDefinition['renderer'], kind = `${id}_text`): StageDefinition => ({
  id, label: id[0].toUpperCase() + id.slice(1), short_label: '', group: 'drafting', required: true, renderer,
  entry_guidance: '', exit_criteria: [], expected_artifacts: [{ kind, cardinality: 'one', primary: true }], recommended_modes: [], skip_reasons: [],
  transitions: { default_next: null, allow_skip: false, allow_return_to: [] },
});
const TEMPLATE = { key: 'custom_hi', stages: [stage('plan', 'prose'), stage('manuscript', 'long_form'), stage('review', 'review', 'critique_report'), stage('memo', 'prose')] } as unknown as WorkflowTemplate;

const rows = (items: Record<string, string>[]) => ({ artifact: null, versions: [{ id: 'rv', version_number: 6, created_at: 't', content: JSON.stringify({ kind: 'stage_items', items }) }] });
const BUNDLES = {
  review: rows([
    { id: 'h2', finding: 'Section 7 uses the multiplicative model.', suggested_change: 'Use the additive model in Section 7.', severity: 'major', status: 'accepted', status_source: 'user' },
    { id: 'h3', finding: 'P0 is called a finding.', suggested_change: 'Call P0 the decisive novelty check.', severity: 'major', status: 'accepted', status_source: 'model', reason: 'Routine.' },
    { id: 'h4', finding: 'A proposal only.', suggested_change: 'x', severity: 'minor', status: 'accepted', status_source: 'proposed' },
    { id: 'h5', finding: 'Done already.', suggested_change: 'y', severity: 'minor', status: 'accepted', status_source: 'model', reason: 'Already carried out in Manuscript v2.' },
    { id: 'h6', finding: 'Rejected.', suggested_change: 'z', severity: 'minor', status: 'rejected', reason: 'No.' },
  ]),
} as never;

describe('accepted fixes go into the manuscript itself', () => {
  it('the review after a manuscript with no revision stage: its accepted rows, each once', () => {
    expect(loneManuscript(TEMPLATE, 'manuscript')).toBe('manuscript');
    const fixes = fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', new Set());
    expect(fixes.map((f) => f.key)).toEqual(['review:h2', 'review:h3']);
    expect(fixes[0].text).toBe('[h2] (Review) Use the additive model in Section 7. — what was found: Section 7 uses the multiplicative model.');
    expect(fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', new Set(['review:h2'])).map((f) => f.key)).toEqual(['review:h3']);
  });

  it('a workflow with a revision stage after the manuscript has its own way: nothing here', () => {
    expect(loneManuscript(BOOK_V1, 'drafting')).toBeNull();
    expect(fixesToCarry(BOOK_V1, BUNDLES, 'drafting', new Set())).toEqual([]);
  });

  it('the rows a succeeded repair carried are not carried again', () => {
    const steps = [
      { action_key: 'recheck_stage', status: 'succeeded', params: { fix_keys: ['review:h2'] } },
      { action_key: 'recheck_stage', status: 'failed', params: { fix_keys: ['review:h3'] } },
    ];
    expect([...carriedKeys(steps as never)]).toEqual(['review:h2']);
  });

  it('is the next required move, on the manuscript, under any policy', () => {
    const state = { current_stage_id: 'memo', stages: { plan: { status: 'complete' }, manuscript: { status: 'completed_with_artifact' }, review: { status: 'complete' }, memo: { status: 'in_progress' } } } as never;
    const fixes = { deliverableId: 'manuscript', rows: fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', new Set()) };
    const move = staleRepair(TEMPLATE, state, [], {}, new Set(), null, {}, false, fixes);
    expect(move?.key).toBe('recheck_stage');
    expect(move?.params).toMatchObject({ stage_id: 'manuscript', fix_keys: ['review:h2', 'review:h3'], accepted_fixes: true });
    expect(move?.rationale).toContain('The review accepted 2 findings that are not in Manuscript yet');
  });

  it('findings accepted after two carries are still carried: carries are not repair tries (17 Nov hand pass)', () => {
    const state = { current_stage_id: 'review', stages: { plan: { status: 'complete' }, manuscript: { status: 'completed_with_artifact' }, review: { status: 'in_progress' }, memo: { status: 'not_started' } } } as never;
    const earlier = [
      { id: 's18', action_key: 'recheck_stage', status: 'succeeded', params: { stage_id: 'manuscript', carried: ['[f3] …'], fix_keys: ['review:f3'], accepted_fixes: true } },
      { id: 's20', action_key: 'recheck_stage', status: 'succeeded', params: { stage_id: 'manuscript', carried: ['[f10] …'], fix_keys: ['review:f10'], accepted_fixes: true } },
    ];
    const tried = repairTries(earlier as never, state, new Set(['s18', 's20']));
    expect(tried).toEqual([]);
    const fixes = { deliverableId: 'manuscript', rows: fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', carriedKeys(earlier as never)) };
    const move = staleRepair(TEMPLATE, state, tried, {}, new Set(), null, {}, false, fixes);
    expect(move?.params).toMatchObject({ stage_id: 'manuscript', fix_keys: ['review:h2', 'review:h3'], accepted_fixes: true });
  });

  it('a row whose carrying failed twice is not tried again', () => {
    const failed = { action_key: 'recheck_stage', status: 'failed', params: { fix_keys: ['review:h3'], accepted_fixes: true } };
    expect([...carriedKeys([failed] as never)]).toEqual([]);
    expect([...carriedKeys([failed, failed] as never)]).toEqual(['review:h3']);
  });

  it('the final check reads that review too', () => {
    expect(acceptedRowsBefore(TEMPLATE, BUNDLES, 'manuscript').map((r) => r.id)).toEqual(['h2', 'h3', 'h5']);
  });
});

describe('a stage that would only copy or correct the manuscript', () => {
  it('Go\'s two stages in Hidden Innovation are copies; a memo or a source check is not', () => {
    expect(copiesTheManuscript('Manuscript corrections from review', 'Apply the review findings to the manuscript text.')).toBe(true);
    expect(copiesTheManuscript('Consolidated manuscript with review fixes', 'One manuscript with every accepted fix.')).toBe(true);
    expect(copiesTheManuscript('Apply remaining accepted changes', 'Write the changes into the chapters.')).toBe(true);
    expect(copiesTheManuscript('Research decision memo', 'Decide whether to proceed.')).toBe(false);
    expect(copiesTheManuscript('P0 and S77 linkage check', 'Check each source for match rates by group.')).toBe(false);
  });
});

describe('rounds of carrying in one run (18 Nov, hand pass: paper, review, paper, review, five rounds deep)', () => {
  const carry = (status = 'succeeded') => ({ action_key: 'recheck_stage', status, params: { accepted_fixes: true, fix_keys: ['review:x'] } }) as never;

  it('marks the rows the user accepted', () => {
    const fixes = fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', new Set());
    expect(fixes.map((f) => [f.key, Boolean(f.byUser)])).toEqual([['review:h2', true], ['review:h3', false]]);
  });

  it('carries Go\'s own accepted rows for two rounds, then only the user\'s', () => {
    const fixes = fixesToCarry(TEMPLATE, BUNDLES, 'manuscript', new Set());
    expect(GO_CARRY_ROUNDS).toBe(2);
    expect(carryThisRun(fixes, [carry()]).map((f) => f.key)).toEqual(['review:h2', 'review:h3']);
    expect(carryThisRun(fixes, [carry(), carry('failed')]).map((f) => f.key)).toEqual(['review:h2']);
    // Other repairs are not rounds of carrying.
    expect(carryThisRun(fixes, [carry(), { action_key: 'recheck_stage', status: 'succeeded', params: {} } as never]).map((f) => f.key)).toEqual(['review:h2', 'review:h3']);
  });

  it('never carries a row that says no change is needed', () => {
    const bundles = { review: rows([
      { id: 'n1', finding: 'The paper uses [S1] within the saved excerpt.', suggested_change: 'No change to the paper is needed. Next step, if wanted: read the full article.', status: 'accepted', status_source: 'model', reason: 'Fine.' },
      { id: 'n2', finding: 'Nothing in the paper needs to change for this.', status: 'accepted', status_source: 'model', reason: 'Fine.' },
      { id: 'n3', finding: 'Chapter 2 gives no turnover figure.', suggested_change: 'Add the 4% against 9% turnover figure.', status: 'accepted', status_source: 'model', reason: 'Fine.' },
    ]) } as never;
    expect(fixesToCarry(TEMPLATE, bundles, 'manuscript', new Set()).map((f) => f.key)).toEqual(['review:n3']);
  });
});
