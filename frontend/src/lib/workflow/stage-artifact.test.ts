import { describe, expect, it } from 'vitest';

import { onlyConfirmsProposals, serializeItems } from './stage-artifact';

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
