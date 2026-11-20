import { describe, expect, it } from 'vitest';

import { refreshStatusWords } from './status-words';

/** 19 Nov (Sean, Inventory Selection): package v10 said "**Undecided.**" for i8 while the review had it accepted. */
const V10 = [
  '| i8. The cost comparison still described Vendor A\'s standing as open. | **Undecided.** Part 2 already states that Vendor A is within budget and is the only qualifying vendor. |',
  '**Result:** the parts are consistent with the supplied rules and with each other. Finding i8 remains undecided. The text it concerns already reflects Vendor A\'s settled standing.',
  '| i9. Headroom is stated twice. | Rejected. Kept once in Part 2. |',
].join('\n');

describe('the status a document gives a finding follows the review table', () => {
  it('rewrites the word that disagrees, keeping its bold and case, and leaves the finding\'s own words alone', () => {
    const out = refreshStatusWords(V10, [{ id: 'i8', status: 'accepted', status_source: 'model' }, { id: 'i9', status: 'rejected' }] as never);
    expect(out.changed).toEqual(['i8']);
    expect(out.content).toContain('| **Accepted.** Part 2 already states');
    expect(out.content).toContain('Finding i8 remains accepted.');
    expect(out.content).toContain("standing as open. |");
    expect(out.content).toContain('| Rejected. Kept once');
  });
  it('"Applied" agrees with accepted; an undecided row is said to be undecided; a superseded one, superseded', () => {
    expect(refreshStatusWords('| i8. x | Applied. Done. |', [{ id: 'i8', status: 'accepted' }] as never).changed).toEqual([]);
    expect(refreshStatusWords('| i8. x | Applied. Done. |', [{ id: 'i8' }] as never).content).toBe('| i8. x | Undecided. Done. |');
    expect(refreshStatusWords('| i8. x | Applied. |', [{ id: 'i8', status: 'accepted', superseded_by: 'Subscription is $41,000.' }] as never).content).toBe('| i8. x | Superseded. |');
  });
  it('a line that does not name the row is untouched, and i1 is not i10', () => {
    expect(refreshStatusWords('| i10. y | Undecided. |', [{ id: 'i1', status: 'accepted' }] as never).changed).toEqual([]);
  });

  // 20 Nov, inventory-selection pass: the package numbered the review's findings 1 to 16.
  const NUMBERED = [
    '## Review findings and status',
    '',
    '| # | Finding | Decision | Status |',
    '|---|---|---|---|',
    "| 1 | All pass/fail cells, margin lines and failure counts match the supplied figures, across the three vendors and every requirement that carries a margin, with the failure counts StockPilot 0, BinLogic 1 (R4) and ShelfWise 1 (R5) carried into this package as they were checked and confirmed in the consistency review, which is long enough to pass four hundred characters before the decision cell begins, as real rows do. | Accepted | Resolved. |",
    '| 2 | The R4 boundary is applied correctly. | Accepted | Resolved. No change needed. |',
    '| 3 | StockPilot\'s phases sum to 7 weeks. | Undecided | Open. |',
  ].join('\n');
  const REVIEW = [{ id: 'i1' }, { id: 'i2', status: 'accepted' }, { id: 'i3', status: 'accepted', status_source: 'model' }];
  it('reads a findings table that numbers the review\'s rows without their "i"', () => {
    const out = refreshStatusWords(NUMBERED, REVIEW as never);
    expect(out.changed.sort()).toEqual(['i1', 'i3']);
    expect(out.content).toContain('as real rows do. | Undecided | Resolved. |');
    expect(out.content).toContain("| StockPilot's phases sum to 7 weeks. | Accepted | Open. |");
    expect(out.content).toContain('| The R4 boundary is applied correctly. | Accepted |');
  });
  it('leaves a numbered table alone when its numbers are not exactly the review\'s, or it is not about findings', () => {
    // Renumbered after a finding was left out: "3" might be i4.
    expect(refreshStatusWords(NUMBERED, [...REVIEW, { id: 'i4', status: 'rejected' }] as never).changed).toEqual([]);
    const requirements = NUMBERED.replace('## Review findings and status', '## Requirements').replace('| # | Finding |', '| # | Requirement |');
    expect(refreshStatusWords(requirements, REVIEW as never).changed).toEqual([]);
  });
});
