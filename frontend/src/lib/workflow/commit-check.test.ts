import { describe, expect, it } from 'vitest';
import { checkCommit } from './commit-check';
import { serializeItems } from './stage-artifact';

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
