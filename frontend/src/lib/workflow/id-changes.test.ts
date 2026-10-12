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
    expect(c).toEqual({ restored: [], renamed: [] });
  });

  it('does not count a removal by a generated version as the user’s', () => {
    expect([...removedByUser([versions[0], { content: NOV9, source_operation: 'agent_revise' }])]).toEqual([]);
  });
});
