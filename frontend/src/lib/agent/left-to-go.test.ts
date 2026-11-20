import { describe, expect, it } from 'vitest';

import { askedIds, choiceEffects, decisionsFromAnswer, namedRows } from './left-to-go';
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

describe('approving a version decides no finding; each answer says what it does (19 Nov, Inventory Selection)', () => {
  const one = [{ id: 'i8', stageId: 'review' }];
  it('"Approve version 13 as final" leaves i8 as it is', () => {
    expect(decisionsFromAnswer('Approve version 13 as final, with Vendor A excluded.', one)).toBeNull();
    expect(decisionsFromAnswer('Accept i8 and approve version 13', one)).toEqual([{ id: 'i8', status: 'accepted' }]);
  });
  it('the question carries each answer\'s effect, as the answer will be read', () => {
    const said = choiceEffects(['Approve version 13 as final', 'Drop i8 and approve version 13'], one);
    expect(said).toContain('- "Approve version 13 as final": i8 stays undecided.');
    expect(said).toContain('- "Drop i8 and approve version 13": i8 rejected.');
    expect(choiceEffects(['Yes', 'No'], [])).toBe('');
  });
});

describe('a finding Go names beside its question, and an option chosen for it (20 Nov, inventory-selection pass)', () => {
  const choices = ['Send the package to Finance now as a no-qualifying-vendor result', 'Hold the package until a vendor confirms nightly Ledgerline export', 'Reject finding 17; the package stands as it is'];
  const timing: OpenRow = { stageId: 'consistency_review', stageLabel: 'Consistency review', id: 'imwob0tqc2', text: 'Send the package now or hold it' };
  it('reads the ids Go gave beside the question, though the question calls it "Finding 17"', () => {
    expect(askedIds({ finding_id: 'imwob0tqc2' })).toEqual(['imwob0tqc2']);
    expect(askedIds({ finding_ids: ['a1', ' a2 '], rows: [{ id: 'a1' }, 'a3'] })).toEqual(['a1', 'a2', 'a3']);
    expect(askedIds(undefined)).toEqual([]);
    expect(namedRows(['Finding 17 (Consistency review) asks …'], [timing], ['imwob0tqc2'])).toEqual([{ id: 'imwob0tqc2', stageId: 'consistency_review', asked: true }]);
    expect(namedRows(['Finding 17 (Consistency review) asks …'], [timing])).toEqual([]);
  });
  it('an offered option decides the one finding asked about, as accepted with the choice kept', () => {
    const rows = [{ id: 'imwob0tqc2', stageId: 'consistency_review', asked: true as const }];
    expect(decisionsFromAnswer(choices[1], rows, choices)).toEqual([
      { id: 'imwob0tqc2', status: 'accepted', reason: 'You chose: Hold the package until a vendor confirms nightly Ledgerline export' },
    ]);
    expect(decisionsFromAnswer(choices[2], rows, choices)).toEqual([{ id: 'imwob0tqc2', status: 'rejected' }]);
    expect(choiceEffects(choices, rows)).toContain('- "Hold the package until a vendor confirms nightly Ledgerline export": imwob0tqc2 accepted, with this as your decision.');
  });
  it('never from words of the user\'s own, an approval, or a finding only mentioned in the text', () => {
    const asked = [{ id: 'i8', stageId: 'review', asked: true as const }];
    expect(decisionsFromAnswer('Hold it for a week', asked, choices)).toBeNull();
    expect(decisionsFromAnswer('Approve version 13 as final', asked, ['Approve version 13 as final', 'Hold it'])).toBeNull();
    expect(decisionsFromAnswer('Keep it open for now', asked, ['Keep it open for now', 'Hold it'])).toBeNull();
    expect(decisionsFromAnswer('Hold it', [{ id: 'i8', stageId: 'review' }], ['Approve', 'Hold it'])).toBeNull();
    expect(decisionsFromAnswer('Hold it', [...asked, { id: 'i9', stageId: 'review', asked: true as const }], ['Approve', 'Hold it'])).toBeNull();
  });
});

