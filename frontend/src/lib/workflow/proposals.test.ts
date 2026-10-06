import { describe, expect, it } from 'vitest';

import { applyProposals, proposalStatuses, proposeSummary, proposeTargets } from './proposals';
import { ITEM_SCHEMAS, confirmProposals, confirmableProposals, isProposed, isTriaged, stageContentForChat, type StageItem } from './stage-artifact';

// 3 Oct (Research run): "PromptMaster proposes a status → user confirms or
// overrides → status becomes authoritative."
const alternatives = ITEM_SCHEMAS.alternatives;

const rows: StageItem[] = [
  { id: 'a1', explanation: 'Raw-material inflation', how_addressed: 'Partly addressed, not excluded', status: 'left_open', reason: 'Input prices rose, but not enough to explain the gap.', status_source: 'proposed' },
  { id: 'a2', explanation: 'Measurement artefact', how_addressed: 'Reconciled to the ledger', status: 'ruled_out', status_source: 'proposed' },
  // A proposal that cannot stand on its own: left open needs a reason.
  { id: 'a3', explanation: 'Mix shift', how_addressed: '', status: 'left_open', status_source: 'proposed' },
  { id: 'a4', explanation: 'Labour', how_addressed: '', status: 'addressed', status_source: 'user' },
];

describe('a proposed status', () => {
  it('is not the user\'s decision until confirmed', () => {
    expect(rows.map((r) => isProposed(r))).toEqual([true, true, true, false]);
    expect(rows.map((r) => isTriaged(r, alternatives))).toEqual([false, false, false, true]);
  });

  it('is confirmed in one step, except where it lacks what its status needs', () => {
    expect(confirmableProposals(rows, alternatives).map((r) => r.id)).toEqual(['a1', 'a2']);
    const after = confirmProposals(rows, alternatives);
    expect(after.map((r) => isTriaged(r, alternatives))).toEqual([true, true, false, true]);
    expect(after[0]).toMatchObject({ status: 'left_open', reason: rows[0].reason, status_source: 'user' });
    expect(after[2].status_source).toBe('proposed');
  });

  it('is told to the chat as a proposal, not a decision', () => {
    expect(stageContentForChat(alternatives, JSON.stringify({ kind: 'stage_items', items: rows.slice(0, 1) }))).toContain(
      '[proposed by PromptMaster, not yet confirmed: Left open: Input prices rose'
    );
  });

  it('the reason a row already gives is offered when its status needs one', () => {
    expect(ITEM_SCHEMAS.alternatives.reasonFrom).toEqual(['how_addressed']);
    expect(ITEM_SCHEMAS.validation_table.reasonFrom).toEqual(['attempt', 'notes']);
    expect(ITEM_SCHEMAS.final_evaluation.reasonFrom).toEqual(['where']);
  });
});

describe('proposals for a table already drafted (R1c)', () => {
  const finalSchema = ITEM_SCHEMAS.final_evaluation;
  const open: StageItem[] = [
    { id: 'f1', item: 'Primary-cause attribution unverified', where: 'No driver-level cost data' },
    { id: 'f2', item: 'Measurement artefact', where: 'Unresolved', status: 'deferred', reason: 'Kept open.', status_source: 'proposed' },
    { id: 'f3', item: 'Commercial pressure', where: 'Plausible', status: 'accepted', status_source: 'user' },
    { id: 'f4', item: 'Mix shift', where: '' },
  ];

  it('targets only rows with neither a decision nor a proposal, on tables that take proposals', () => {
    expect(proposeTargets(open, finalSchema).map((r) => r.id)).toEqual(['f1', 'f4']);
    expect(proposeTargets([{ id: 'r1', run: 'x' }], ITEM_SCHEMAS.runs)).toEqual([]);
  });

  it('applies a proposal only to a target, with a proposable status and a reason', () => {
    const { items, applied } = applyProposals(open, [
      { id: 'f1', status: 'deferred', reason: 'No driver-level cost data, so it stays open.' },
      { id: 'f3', status: 'deferred', reason: 'Not a target: the user decided it.' },
      { id: 'f4', status: 'accepted', reason: '' },
    ], finalSchema);
    expect(applied).toEqual(['f1']);
    expect(items[0]).toMatchObject({ status: 'deferred', status_source: 'proposed' });
    expect(items[2]).toEqual(open[2]);
    expect(items[3]).toEqual(open[3]);
  });

  it('never proposes a reproduction', () => {
    expect(proposalStatuses(ITEM_SCHEMAS.validation_table).map((s) => s.value)).toEqual(['supported_by_prior', 'consistency_check', 'not_attempted']);
  });

  it('says what it did, and that nothing is saved yet', () => {
    expect(proposeSummary(2, 3)).toBe('PromptMaster proposed a status for 2 rows, each with its reason. 1 row does not say enough to tell. Nothing is saved until you confirm or save.');
    expect(proposeSummary(0, 3)).toMatch(/could not tell a status/);
  });
});
