import { describe, expect, it } from 'vitest';

import { carriedKeys, copiesTheManuscript, fixesToCarry, loneManuscript } from './manuscript-fixes';
import { staleRepair } from './needs';
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
