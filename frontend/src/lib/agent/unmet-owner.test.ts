import { describe, expect, it } from 'vitest';
import { ownerOfAll, redoesStage, unmetElsewhere, unmetOfJudged, unmetOwner } from './unmet-owner';

// The shape of the 18 Nov hand pass: a paper, its review, and a one-page memo after them.
const template = {
  stages: [
    { id: 'paper', label: 'Write the paper in three chapters', short_label: 'Paper' },
    { id: 'review', label: 'Independent critical review of the paper', short_label: 'Critical review' },
    { id: 'memo', label: 'One-page board decision memo', short_label: 'Board memo' },
  ],
} as never;

const measured = {
  memo: [{ id: 'm1', label: 'Memo: at most 1 page (estimated)', satisfied: false, detail: 'about 1.1 pages (605 words; estimated at 550 words a page)' }],
  paper: [{ id: 'p1', label: 'Each chapter: at most 900 words', satisfied: true, detail: 'about 800 words' }],
};

// What the check recorded on production, word for word.
const unmet = [
  'One-page board decision memo: Memo: at most 1 page (estimated) — measured about 1.1 pages (605 words; estimated at 550 words a page)',
  "A one-page decision memo for a board — The project's own check (S8) measured the memo at about 1.1 pages (605 words; estimated at 550 words a page), over the one-page limit",
];

describe('which stage an unmet item is about (18 Nov, hand pass)', () => {
  it('a failed check sent as "<stage>: …" is that stage’s', () => {
    expect(unmetOwner(template, {}, unmet[0])).toBe('memo');
  });

  it("the check's own words that quote a stage's failed count are that stage's", () => {
    expect(unmetOwner(template, measured, unmet[1])).toBe('memo');
  });

  it('a count that was met says nothing about where an item belongs', () => {
    expect(unmetOwner(template, measured, 'The paper is about 800 words a chapter but never names the pilot.')).toBeNull();
  });

  it('an item about the text the check read stays with it', () => {
    expect(unmetOwner(template, measured, 'The answer does not say how many firms kept the four-day week.')).toBeNull();
  });

  it('the memo’s length, found by a check of the paper, is not carried into the paper', () => {
    const items = [...unmet, 'Chapter 2 does not give the turnover figure.'];
    const elsewhere = unmetElsewhere(template, measured, 'paper', items);
    expect(elsewhere).toEqual([{ item: unmet[0], stage_id: 'memo' }, { item: unmet[1], stage_id: 'memo' }]);
    expect(unmetOfJudged(items, elsewhere)).toEqual(['Chapter 2 does not give the turnover figure.']);
    expect(ownerOfAll(items, elsewhere)).toBeNull();
  });

  it('when everything unmet is one other stage’s, the card goes to that stage', () => {
    expect(ownerOfAll(unmet, unmetElsewhere(template, measured, 'paper', unmet))).toBe('memo');
  });

  it('an item on the stage the check read is not "elsewhere"', () => {
    expect(unmetElsewhere(template, measured, 'memo', unmet)).toEqual([]);
  });
});

describe('a next task that only redoes a written stage (18 Nov: "Trim board memo to one page" was added beside the memo)', () => {
  const written = new Set(['paper', 'review', 'memo']);

  it('is that stage, by its short label', () => {
    expect(redoesStage(template, written, 'Trim board memo to one page', 'Cut 55 words.')?.id).toBe('memo');
  });

  it('is that stage, by its label in the work', () => {
    expect(redoesStage(template, written, 'One page', 'Revise the latest One-page board decision memo (v5) to 550 words or fewer.')?.id).toBe('memo');
  });

  it('new work is not a redo, even when it names a stage', () => {
    expect(redoesStage(template, written, 'Sensitivity check of the pilot figures', 'Recompute the Paper’s median under each exclusion.')).toBeNull();
  });

  it('a stage with nothing written yet is not redone', () => {
    expect(redoesStage(template, new Set(['paper']), 'Trim board memo to one page', '')).toBeNull();
  });

  it('a name inside another word does not count', () => {
    const t = { stages: [{ id: 'memo', label: 'Memo', short_label: 'Memo' }] } as never;
    expect(redoesStage(t, new Set(['memo']), 'Update memorandum index', '')).toBeNull();
  });
});
