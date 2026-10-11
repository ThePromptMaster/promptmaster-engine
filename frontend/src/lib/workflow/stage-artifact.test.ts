import { describe, expect, it } from 'vitest';

import { ITEM_SCHEMAS, onlyConfirmsProposals, serializeItems, statusContradictsRow } from './stage-artifact';
import { reasonFromRow } from './run-result';

describe('confirming proposals changes nothing a later stage read (L-66, 9 Oct)', () => {
  const rows = [
    { id: 'a', explanation: 'Misindexing', status: 'ruled_out', status_source: 'proposed', reason: 'fixed definition' },
    { id: 'b', explanation: 'Wrong start values', status: 'ruled_out', status_source: 'user', reason: 'given' },
  ];
  const before = serializeItems(rows as never);
  it('a save that only confirms proposals is recognised', () => {
    expect(onlyConfirmsProposals(before, serializeItems(rows.map((r) => ({ ...r, status_source: 'user' })) as never))).toBe(true);
    expect(onlyConfirmsProposals(before, serializeItems(rows.map((r) => ({ ...r, status_source: r.id === 'a' ? 'policy' : r.status_source })) as never))).toBe(true);
  });
  it('a changed status, text or row, or nothing confirmed, is a real change', () => {
    expect(onlyConfirmsProposals(before, serializeItems(rows.map((r) => ({ ...r, status_source: 'user', status: 'left_open' })) as never))).toBe(false);
    expect(onlyConfirmsProposals(before, serializeItems(rows.map((r) => ({ ...r, status_source: 'user', reason: 'other' })) as never))).toBe(false);
    expect(onlyConfirmsProposals(before, serializeItems([rows[0]] as never))).toBe(false);
    expect(onlyConfirmsProposals(before, before)).toBe(false);
    expect(onlyConfirmsProposals('plain prose', 'plain prose')).toBe(false);
  });
});

describe('a status the row contradicts (Sean, 10 Oct, email 6.9)', () => {
  it('flags "Reproduced" on a row that says it was not', () => {
    expect(statusContradictsRow({ id: 'v', result: 'Margin fell', attempt: 'Not reproduced: compared with earlier studies only.', status: 'reproduced' })).toMatch(/says it was not reproduced/);
    expect(statusContradictsRow({ id: 'v', result: 'Margin fell', attempt: 'Recalculated from the CSV; same answer.', status: 'independently_reproduced' })).toBeNull();
    expect(statusContradictsRow({ id: 'v', result: 'x', attempt: 'Not reproduced.', status: 'consistency_check' })).toBeNull();
  });
  it('a run marked Not run takes its reason from what the row already says', () => {
    expect(reasonFromRow({ id: 'r', run: 'Cohort comparison', producible_by: 'Needs data — account-level churn records' }, ITEM_SCHEMAS.runs)).toBe('Needs data — account-level churn records');
  });
});
