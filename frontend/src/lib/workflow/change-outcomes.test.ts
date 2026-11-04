/**
 * 4 Nov (Sean): "After a change, show which stages were affected, which were
 * updated, which were rechecked, and which still have open findings."
 */
import { describe, expect, it } from 'vitest';

import { changeOutcomes } from './change-outcomes';

const since = '2026-11-04T12:00:00Z';
const stages = [
  { id: 'figures', renderer: 'list' as const },
  { id: 'draft', renderer: 'prose' as const },
  { id: 'check', renderer: 'review' as const },
  { id: 'final', renderer: 'prose' as const },
];
const v = (id: string, n: number, at: string, op = 'agent_revise') => ({ id, version_number: n, created_at: at, source_operation: op });
const versions: Record<string, ReturnType<typeof v>[]> = {
  figures: [v('f1', 1, '2026-11-04T11:00:00Z', 'agent_draft'), v('f2', 2, '2026-11-04T12:05:00Z')],
  draft: [v('d1', 1, '2026-11-04T11:10:00Z'), v('d2', 2, '2026-11-04T12:10:00Z', 'stage_edit')],
  check: [v('c1', 1, '2026-11-04T11:20:00Z', 'agent_draft')],
  final: [v('x1', 1, '2026-11-04T11:30:00Z'), v('x2', 2, '2026-11-04T12:20:00Z')],
};
const evaluations = {
  d2: { findings: [] },
  x2: { findings: [{}, {}] },
};

describe('what became of each stage a change reopened', () => {
  it('says the version, who made it, and what the check on it found', () => {
    const out = changeOutcomes(['figures', 'draft', 'check', 'final'], since, stages, (id) => versions[id] ?? [], evaluations, (id) => (id === 'figures' ? 0 : id === 'check' ? 2 : 0));
    expect(out).toEqual([
      // A plain table (facts and figures) has nothing to decide (4 Nov, prod pass).
      { stageId: 'figures', version: 2, by: 'go', check: 'none', count: 0 },
      { stageId: 'draft', version: 2, by: 'you', check: 'clean', count: 0 },
      // Finished again without a new version: kept as it was; its rows still undecided.
      { stageId: 'check', version: null, by: null, check: 'table', count: 2 },
      { stageId: 'final', version: 2, by: 'go', check: 'findings', count: 2 },
    ]);
  });

  it('a version with no check, or one that could not run, is "not checked"', () => {
    const out = changeOutcomes(['final'], since, stages, (id) => versions[id] ?? [], { x2: { failed: true, findings: [] } }, () => 0);
    expect(out[0]).toMatchObject({ version: 2, check: 'not_checked' });
    expect(changeOutcomes(['final'], since, stages, (id) => versions[id] ?? [], {}, () => 0)[0].check).toBe('not_checked');
  });
});
