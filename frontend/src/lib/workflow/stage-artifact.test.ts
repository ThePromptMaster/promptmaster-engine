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

describe('deferred rows that do not block are named with their reason (10 Oct, email 6.6)', () => {
  it('lists a deferred polish row, not one that says a requirement is unmet', async () => {
    const { deferredNotBlocking, itemSchemaFor } = await import('./stage-artifact');
    const { SINGLE_OUTPUT_V1 } = await import('./templates/single-output.v1');
    const schema = itemSchemaFor(SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'summary')!);
    const key = schema.fields[0].key;
    const rows = [
      { id: 'a', [key]: 'Tighten the closing line', status: 'deferred', reason: 'Style only; after launch.' },
      { id: 'b', [key]: 'The pricing section is missing', status: 'deferred', reason: 'Later.' },
      { id: 'c', [key]: 'Fine as is', status: 'accepted', reason: 'ok' },
    ];
    expect(deferredNotBlocking(rows as never, schema)).toEqual([{ row: 'Tighten the closing line', reason: 'Style only; after launch.' }]);
  });
});
