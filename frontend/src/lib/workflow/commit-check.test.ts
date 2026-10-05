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

  it('refuses a rewrite that lost most of the text', () => {
    expect(checkCommit({ before: PROSE, after: 'Short.', operation: 'applied_recommendations' })).toMatch(/lost most/);
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
