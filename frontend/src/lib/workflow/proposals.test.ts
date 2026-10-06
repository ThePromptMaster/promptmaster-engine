import { describe, expect, it } from 'vitest';

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
