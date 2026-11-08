import { describe, expect, it } from 'vitest';
import { hasIdChanges, idChanges, idRule, itemIds, removedByUser, withIdFormsKept } from './id-changes';

const NOV2 = '| D1 | Ops |\n| D2 | Finance |\n| D3 | Supplier |\n| D4 | IT |\nR-002: unfilled vacancies';
const NOV9 = '| D1 | Ops |\n| D2 | Finance |\n| D4 | IT |\nR-002: unfilled vacancies — resolved';

describe('itemIds', () => {
  it('reads register and proposal IDs, and ignores years and plain words', () => {
    expect([...itemIds('R-002 and D3-P in Q4 2026; COVID-19 a1 S7')].sort()).toEqual(['D3-P', 'Q4', 'R-002', 'S7']);
  });
});

describe('Meridian: a revision that undoes the user', () => {
  const versions = [
    { content: NOV2, source_operation: 'stage_generate' },
    { content: NOV9, source_operation: 'chat_instruct' },
  ];

  it('knows what the user removed', () => {
    expect([...removedByUser(versions)]).toEqual(['D3']);
  });

  it('flags restoring a removed row and renaming a proposal', () => {
    const c = idChanges({ head: NOV9 + '\nProposal P7', generated: NOV2 + '\nProposal P7-P', removed: removedByUser(versions) });
    expect(c.restored).toEqual(['D3']);
    expect(c.renamed).toEqual([['P7', 'P7-P']]);
  });

  it('lets a revision that keeps the record through', () => {
    const c = idChanges({ head: NOV9, generated: NOV9.replace('Ops', 'Operations'), removed: removedByUser(versions) });
    expect(c).toEqual({ restored: [], renamed: [], reused: [] });
  });

  it('does not count a removal by a generated version as the user’s', () => {
    expect([...removedByUser([versions[0], { content: NOV9, source_operation: 'agent_revise' }])]).toEqual([]);
  });
});

describe('an ID given to a different item (13 Oct; Sean: vacancy issue overwritten)', () => {
  const head = '| I-03 | Maintenance vacancy at the north depot remains unfilled after recruiting | Luis | Open |';
  it('is caught when the line is about something else', () => {
    const generated = '| I-03 | Onboarding checklist for new reporting analysts lacks training sessions | Morgan | Open |';
    expect(idChanges({ head, generated, removed: new Set() }).reused).toEqual(['I-03']);
  });
  it('is not caught when the same item is closed or reworded', () => {
    const closed = '| I-03 | Maintenance vacancy at the north depot filled after recruiting round | Luis | Closed |';
    expect(idChanges({ head, generated: closed, removed: new Set() }).reused).toEqual([]);
  });
});

describe('a prefixed ID, and an ID mentioned in prose (18 Oct, pilot)', () => {
  it('reads KES-T3 whole, never as a separate T3', () => {
    expect([...itemIds('KES-T3 Testing starts after KES-T2; see D3.')].sort()).toEqual(['D3', 'KES-T2', 'KES-T3']);
  });

  it('an objective that mentions KES-T3 in a different sentence has not reused it', () => {
    const head = 'The pack covers five tasks. KES-T3 Testing has not started and starts after KES-T2 completes.';
    const generated = 'As of November 5, the build forecast moved to November 12. That delays KES-T3 Testing by three days after KES-T2 finishes.';
    expect(idChanges({ head, generated, removed: new Set() }).reused).toEqual([]);
  });

  it('a register row that now holds a different item is still caught', () => {
    const head = '| KES-T3 | Testing of the release candidate on staging servers | Not started |';
    const generated = '| KES-T3 | Vendor contract renewal negotiation with procurement lawyers | Open |';
    expect(idChanges({ head, generated, removed: new Set() }).reused).toEqual(['KES-T3']);
  });
});

describe('a revision that only respells an ID, or mentions a removed one (8 Nov, production)', () => {
  it('P-1 and P1 are the same ID: put back in code, not refused', () => {
    const head = '| P-1 | Prediction one |\n| R-002 | Risk |';
    const generated = '| P1 | Prediction one |\n| R2 | Risk |\nSee P1 and R2.';
    const c = idChanges({ head, generated, removed: new Set() });
    expect(c.reformatted).toEqual([['P-1', 'P1'], ['R-002', 'R2']]);
    expect(hasIdChanges(c)).toBe(false);
    expect(withIdFormsKept(generated, c)).toBe('| P-1 | Prediction one |\n| R-002 | Risk |\nSee P-1 and R-002.');
  });

  it('a suffix is a different ID, and is still refused', () => {
    const c = idChanges({ head: 'Proposal P7', generated: 'Proposal P7-P', removed: new Set() });
    expect(c.renamed).toEqual([['P7', 'P7-P']]);
    expect(hasIdChanges(c)).toBe(true);
  });

  it('a removed ID mentioned in a sentence restores nothing', () => {
    const c = idChanges({ head: 'Sessions T1 and T6.', generated: 'Sessions T1 and T6, replacing T2 and T3.', removed: new Set(['T2', 'T3']) });
    expect(c.restored).toEqual([]);
  });

  it('a removed ID back as a row, a list item or a cell is restored', () => {
    const removed = new Set(['D3']);
    expect(idChanges({ head: '', generated: '| D3 | Supplier |', removed }).restored).toEqual(['D3']);
    expect(idChanges({ head: '', generated: '- D3: Supplier', removed }).restored).toEqual(['D3']);
    expect(idChanges({ head: '', generated: '| Supplier | **D3** | Open |', removed }).restored).toEqual(['D3']);
  });

  it('the rule goes with the first attempt, and only where there are IDs', () => {
    expect(idRule(4, 'No identifiers here at all.', new Set())).toBe('');
    const rule = idRule(4, '| D1 | Ops |', new Set(['D3']));
    expect(rule).toContain('Keep every item ID as v4 has it');
    expect(rule).toContain('Do not bring back D3.');
  });
});

