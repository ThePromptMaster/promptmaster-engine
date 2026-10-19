import { describe, expect, it } from 'vitest';
import { checkCommit, restoreDecided, droppedDecisions } from './commit-check';
import type { StageItem } from './stage-artifact';
import { parseItems, serializeItems } from './stage-artifact';

const TABLE = serializeItems([
  { id: 'a', claim: 'Option A: close the plant' },
  { id: 'b', claim: 'Option B: reprice contracts' },
]);
const PROSE = 'A '.repeat(400);

describe('checkCommit: what may become the current version', () => {
  it('refuses a revision that came back empty', () => {
    expect(checkCommit({ before: PROSE, after: '  ', operation: 'applied_findings' })).toMatch(/empty/);
  });

  it('refuses prose where the stage holds a table (the Options v3, 4 Oct)', () => {
    expect(checkCommit({ before: TABLE, after: 'Here is the revised comparison…', operation: 'applied_recommendations' })).toMatch(/text instead of a table/);
  });

  it('refuses a table that lost every row', () => {
    expect(checkCommit({ before: TABLE, after: serializeItems([]), operation: 'applied_findings' })).toMatch(/no rows/);
  });

  it('accepts a table revision with rows', () => {
    expect(checkCommit({ before: TABLE, after: serializeItems([{ id: 'c', claim: 'Option C' }]), operation: 'applied_findings' })).toBeNull();
  });

  it('lets a rewrite cut a draft down, when that is what the findings asked (6 Oct)', () => {
    expect(checkCommit({ before: PROSE, after: 'Short.', operation: 'applied_findings' })).toBeNull();
  });

  it('lets a short first draft or an added section through', () => {
    expect(checkCommit({ before: undefined, after: 'Short.', operation: 'stage_draft' })).toBeNull();
    expect(checkCommit({ before: PROSE, after: 'Short.', operation: 'continuation' })).toBeNull();
  });

  it('an outline is not a table: the finished report can be filed on its row (Research, Drafting)', () => {
    const outline = JSON.stringify({ schema: 1, items: [{ id: 's1', title: 'Introduction' }], orphans: [] });
    expect(checkCommit({ before: outline, after: '# The full report', operation: 'long_form_complete' })).toBeNull();
  });

  it('lets the user empty a table or a draft by hand', () => {
    expect(checkCommit({ before: TABLE, after: serializeItems([]), operation: 'stage_edit' })).toBeNull();
    expect(checkCommit({ before: PROSE, after: '', operation: 'stage_edit' })).toBeNull();
  });
});

describe('checkCommit: what the user decided, and what moved underneath (6 Oct)', () => {
  const DECIDED = serializeItems([
    { id: 'a', claim: 'Option A: close the plant', status: 'ruled_out', reason: 'Union contract', status_source: 'user' },
    { id: 'b', claim: 'Option B: reprice contracts' },
  ]);

  it('refuses an unreviewed revision that drops a row the user decided, and names it', () => {
    const after = serializeItems([{ id: 'b', claim: 'Option B: reprice contracts' }]);
    for (const operation of ['agent_revise', 'applied_findings', 'agent_triage']) {
      expect(checkCommit({ before: DECIDED, after, operation })).toMatch(/dropped a row you had decided \("Option A: close the plant"\)/);
    }
  });

  it('lets the user drop it themselves, or through a chat proposal they accepted', () => {
    const after = serializeItems([{ id: 'b', claim: 'Option B: reprice contracts' }]);
    for (const operation of ['stage_edit', 'chat_instruct', 'chat_rows']) {
      expect(checkCommit({ before: DECIDED, after, operation })).toBeNull();
    }
  });

  it('lets a revision drop rows nobody decided (the wanted cut, 6 Oct)', () => {
    const after = serializeItems([{ id: 'a', claim: 'Option A', status: 'ruled_out', reason: 'Union contract', status_source: 'user' }]);
    expect(checkCommit({ before: DECIDED, after, operation: 'agent_revise' })).toBeNull();
  });

  it('counts a decision carried onto a renumbered row as kept', () => {
    const after = serializeItems([
      { id: 'r1', claim: 'Close the plant', status: 'ruled_out', reason: 'Union contract', status_source: 'user' },
    ]);
    expect(checkCommit({ before: DECIDED, after, operation: 'agent_revise' })).toBeNull();
  });

  it('treats a status with no source as the user’s, and a model proposal as nobody’s', () => {
    const legacy = serializeItems([{ id: 'a', claim: 'A', status: 'addressed' }, { id: 'b', claim: 'B', status: 'left_open', reason: 'r', status_source: 'proposed' }]);
    expect(checkCommit({ before: legacy, after: serializeItems([{ id: 'b', claim: 'B' }]), operation: 'agent_revise' })).toMatch(/dropped/);
    expect(checkCommit({ before: legacy, after: serializeItems([{ id: 'a', claim: 'A', status: 'addressed' }]), operation: 'agent_revise' })).toBeNull();
  });

  it('refuses a revision made from a version that is no longer current', () => {
    expect(checkCommit({ before: PROSE, after: 'New text.', operation: 'applied_findings', base: 'An older draft.' })).toMatch(/changed while this revision was being made/);
    expect(checkCommit({ before: PROSE, after: 'New text.', operation: 'applied_findings', base: PROSE })).toBeNull();
    expect(checkCommit({ before: undefined, after: 'First.', operation: 'agent_draft', base: '' })).toBeNull();
  });
});

describe('one rule for a dropped decision and its restore (15 Oct, HARBOR)', () => {
  const json = (items: StageItem[]) => JSON.stringify({ kind: 'stage_items', items });
  const before: StageItem[] = [
    { id: 'i1', finding: 'Launch moved to November 24', status: 'accepted', status_source: 'user' },
    { id: 'i2', finding: 'Budget raised to $44,000', status: 'accepted', status_source: 'user' },
    { id: 'i3', finding: 'Testing still open' },
  ];

  it('a model echo of a user decision under a new id is replaced by the original, and the save passes', () => {
    const after: StageItem[] = [
      { id: 'n1', finding: 'Launch moved to November 24', status: 'accepted', status_source: 'model' },
      { id: 'i3', finding: 'Testing still open' },
    ];
    expect(droppedDecisions(before, after).map((r) => r.id)).toEqual(['i1', 'i2']);
    const out = restoreDecided(before, after);
    expect(out.map((r) => r.id)).toEqual(['i1', 'i2', 'i3']);
    expect(checkCommit({ before: json(before), after: json(out), operation: 'agent_revise' })).toBeNull();
  });

  it('a surviving row does not stand in for a different dropped one', () => {
    const after: StageItem[] = [before[0], before[2]];
    expect(droppedDecisions(before, after).map((r) => r.id)).toEqual(['i2']);
    expect(checkCommit({ before: json(before), after: json(restoreDecided(before, after)), operation: 'agent_revise' })).toBeNull();
  });

  it('a decision carried onto a renumbered row by the user still counts as kept', () => {
    const after: StageItem[] = [{ ...before[0], id: 'n1' }, { ...before[1], id: 'n2' }, before[2]];
    expect(droppedDecisions(before, after)).toEqual([]);
    expect(restoreDecided(before, after).map((r) => r.id)).toEqual(['n1', 'n2', 'i3']);
  });
});

describe('checkCommit: provenance is not a decision, and a restructure is not a drop (18 Oct, Theory of Everything)', () => {
  // Rows from prod v1 90090ce6: ten "candidate source" rows, no status_source.
  const I7 = {
    id: 'i7',
    claim: 'Established target: empirical recovery conditions are mandatory—there must be a controlled classical/low-energy limit reproducing GR where tested and a controlled nongravitational limit reproducing established particle physics.',
    source: 'Project record: “recovery of GR and established QFT limits”',
    status: 'candidate_source',
  };
  const I8 = {
    id: 'i8',
    claim: 'Established target: mathematical consistency must cover anomalies, divergences, and approximation control—a candidate cannot rely on undefined dynamics, inconsistent couplings, or uncontrolled truncations.',
    source: 'Project record: “controlled approximations,” “anomalies,” “uncontrollable divergences”',
    status: 'candidate_source',
  };
  const I1 = { id: 'i1', claim: 'Established target: recover general relativity in an appropriate limit.', source: 'Project record', status: 'candidate_source' };
  const V1 = serializeItems([I1, I7, I8]);

  it('a "candidate source" row with no source recorded is not the user\'s decision', () => {
    expect(droppedDecisions(parseItems(V1)!, [I1])).toEqual([]);
    expect(checkCommit({ before: V1, after: serializeItems([I1]), operation: 'applied_findings' })).toBeNull();
  });

  it('a row the user decided, reworded into a table row under a new id, is carried', () => {
    const decided = { ...I7, status: 'verified', status_source: 'user' };
    const table = { id: 'r2', claim: 'Empirical recovery conditions (mandatory): a controlled classical/low-energy limit reproducing GR where tested, and a controlled nongravitational limit reproducing established particle physics.', source: I7.source, status: 'verified', status_source: 'user' };
    const before = serializeItems([I1, decided]);
    expect(checkCommit({ before, after: serializeItems([I1, table]), operation: 'applied_findings' })).toBeNull();
    expect(restoreDecided(parseItems(before)!, [I1, table])).toEqual([I1, table]);
  });

  it('a row the user decided that is really gone is still refused', () => {
    const decided = { ...I7, status: 'verified', status_source: 'user' };
    const other = { id: 'r2', claim: 'Something else entirely about cosmology and dark energy budgets', source: 'x' };
    expect(checkCommit({ before: serializeItems([I1, decided]), after: serializeItems([I1, other]), operation: 'applied_findings' })).toMatch(/dropped a row you had decided/);
  });

  it('a reworded row whose decision changed is not carried', () => {
    const decided = { ...I7, status: 'verified', status_source: 'user' };
    const table = { id: 'r2', claim: I7.claim, source: I7.source, status: 'removed', status_source: 'user' };
    expect(checkCommit({ before: serializeItems([I1, decided]), after: serializeItems([I1, table]), operation: 'applied_findings' })).toMatch(/dropped a row/);
  });
});
