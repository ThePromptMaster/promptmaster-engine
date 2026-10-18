import { describe, expect, it } from 'vitest';
import { idChanges, itemIds, removedByUser } from './id-changes';

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
