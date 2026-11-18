import { describe, expect, it } from 'vitest';

import { decisionsFromAnswer, namedRows } from './left-to-go';
import type { OpenRow } from './needs';

const open: OpenRow[] = [
  { stageId: 'independent_critical_review', stageLabel: 'Review (H)', id: 'h16', text: 'Make the novelty claim conditional' },
  { stageId: 'independent_critical_review', stageLabel: 'Review (H)', id: 'h17', text: 'Define the false-link parameter the same way in every chapter' },
  { stageId: 'independent_critical_review', stageLabel: 'Review (H)', id: 'h1', text: 'Something already decided elsewhere' },
];

describe('the rows a question names (18 Nov, Hidden Innovation)', () => {
  it('by id, in the question or its answers, never by a longer id', () => {
    const rows = namedRows(['Should I accept review findings h16 and h17?', 'Accept both h16 and h17'], open);
    expect(rows).toEqual([
      { id: 'h16', stageId: 'independent_critical_review' },
      { id: 'h17', stageId: 'independent_critical_review' },
    ]);
  });
  it('none when the question names none', () => {
    expect(namedRows(['Which way should this go?'], open)).toEqual([]);
  });
});

describe('what a chosen answer decides', () => {
  const rows = [{ id: 'h16', stageId: 'r' }, { id: 'h17', stageId: 'r' }];
  it('"Accept both h16 and h17"', () => {
    expect(decisionsFromAnswer('Accept both h16 and h17', rows)).toEqual([
      { id: 'h16', status: 'accepted' },
      { id: 'h17', status: 'accepted' },
    ]);
  });
  it('one each way', () => {
    expect(decisionsFromAnswer('Accept h16, reject h17', rows)).toEqual([
      { id: 'h16', status: 'accepted' },
      { id: 'h17', status: 'rejected' },
    ]);
  });
  it('"Reject both" and "don\'t apply them"', () => {
    expect(decisionsFromAnswer('Reject both', rows)?.map((d) => d.status)).toEqual(['rejected', 'rejected']);
    expect(decisionsFromAnswer("Don't apply them", rows)?.map((d) => d.status)).toEqual(['rejected', 'rejected']);
  });
  it('an answer that decides nothing is not guessed', () => {
    expect(decisionsFromAnswer('Do whatever is best', rows)).toBeNull();
    expect(decisionsFromAnswer('Ask the author first', rows)).toBeNull();
    // A verb with no row and no "both/all": not a decision about these rows.
    expect(decisionsFromAnswer('Accept the memo as it is', rows)).toBeNull();
  });
});
