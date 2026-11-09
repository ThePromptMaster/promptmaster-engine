import { describe, expect, it } from 'vitest';

import { continuationTail, CONTINUE_TAIL_CHARS, cutSections, endsMidSentence, everCutIds, isCutSection, joinContinuation, splitUnfinished, rewriteToCarryOn } from './continuation';
import type { OutlineSection } from '@/types';

const LONG = 'The study followed four hundred people across a decade and reached';

describe('endsMidSentence (8 Nov, production: "Tet", "treating a cons")', () => {
  it('reads the real endings as cut', () => {
    expect(endsMidSentence(`First paragraph.\n\nIn *Expert Political Judgment* (2005), as reported across the whole of that book, Tet`)).toBe(true);
    expect(endsMidSentence('The habit it showed was secular interpretive transfer, the habit of treating a cons')).toBe(true);
    expect(endsMidSentence(`${LONG} a conclusion,`)).toBe(true);
  });

  it('reads finished prose as finished', () => {
    for (const end of ['Neither result has been shown.', 'Is that the question?', 'It holds!', 'He said "stop."', 'As shown in [S12]', 'And so on…']) {
      expect(endsMidSentence(`${LONG} and ended. ${end}`)).toBe(false);
    }
  });

  it('never reads a table, list, heading or sign-off as a broken sentence', () => {
    for (const end of ['| Total | 8 | and a row that goes on for a good many more words here', '- a list item without a full stop that runs on for many words', '## A heading that is long and has no full stop at all in it', 'Kind regards, Jane']) {
      expect(endsMidSentence(`Text before.\n${end}`)).toBe(false);
    }
  });

  it('is conservative about other scripts', () => {
    expect(endsMidSentence('这是一个没有句号结尾的很长的句子而且它继续写了很多很多字')).toBe(false);
    expect(endsMidSentence('یہ ایک جملہ ہے جو بہت لمبا ہے اور اس کے آخر میں کوئی نقطہ نہیں ہے')).toBe(false);
  });

  it('is false for nothing', () => {
    expect(endsMidSentence('   ')).toBe(false);
  });
});

describe('what counts as cut', () => {
  const s = (over: Partial<OutlineSection>): OutlineSection => ({ id: 'a', title: 'A', abstract: '', status: 'complete', content: `${LONG} and stopped.`, finish_reason: 'stop', ...over }) as OutlineSection;

  it('a section stopped at the limit is cut; a section that is not written is not', () => {
    expect(isCutSection(s({ finish_reason: 'length' }))).toBe(true);
    expect(isCutSection(s({ status: 'pending', finish_reason: 'length' }))).toBe(false);
  });

  it('ending mid-sentence counts only for a section once cut', () => {
    const open = s({ content: `${LONG} a conclusion that` });
    expect(isCutSection(open)).toBe(false);
    expect(isCutSection(open, true)).toBe(true);
    expect(isCutSection(s({}), true)).toBe(false);
  });

  it('finds sections once cut from the log, because later passes overwrote the field', () => {
    const events = [
      { type: 'section_written', payload: { section_id: 'a', finish_reason: 'length' } },
      { type: 'section_written', payload: { section_id: 'a', finish_reason: 'stop' } },
      { type: 'section_written', payload: { section_id: 'b', finish_reason: 'stop' } },
      { type: 'stage_marked_complete', payload: { finish_reason: 'length', section_id: 'c' } },
    ];
    expect([...everCutIds(events)]).toEqual(['a']);
    const outline = [s({ id: 'a', content: `${LONG} a conclusion that` }), s({ id: 'b', content: `${LONG} a conclusion that` })];
    expect(cutSections(outline, events).map((x) => x.id)).toEqual(['a']);
  });
});

describe('joining a continuation', () => {
  it('replaces the unfinished sentence, so a word cut in half joins cleanly', () => {
    const { kept, unfinished } = splitUnfinished('One sentence. In 2005, Tet');
    expect(kept).toBe('One sentence. ');
    expect(unfinished).toBe('In 2005, Tet');
    expect(joinContinuation(kept, 'In 2005, Tetlock showed it.')).toBe('One sentence. In 2005, Tetlock showed it.');
  });

  it('a section that stopped at a full stop carries on after it', () => {
    const { kept, unfinished } = splitUnfinished('One sentence.');
    expect(unfinished).toBe('');
    expect(joinContinuation(kept, 'The next one.')).toBe('One sentence.\n\nThe next one.');
  });

  it('breaks at a line as well as at a sentence', () => {
    expect(splitUnfinished('A heading\nThe text goes on and')).toEqual({ kept: 'A heading\n', unfinished: 'The text goes on and' });
  });

  it('a reply that starts the section over replaces it rather than doubling it', () => {
    const start = 'The section opens with a sentence that is long enough to recognise again.';
    const { kept } = splitUnfinished(`${start} Then it goes on until it stops at`);
    expect(joinContinuation(kept, `${start} Then it goes on and finishes.`)).toBe(`${start} Then it goes on and finishes.`);
  });

  it('shows the model only where it stopped', () => {
    expect(continuationTail('x'.repeat(CONTINUE_TAIL_CHARS + 50))).toHaveLength(CONTINUE_TAIL_CHARS);
    expect(continuationTail('short')).toBe('short');
  });
});

describe('rewriteToCarryOn', () => {
  it('gives a first draft nothing', () => {
    expect(rewriteToCarryOn(undefined, 'old text', 'new')).toEqual({});
  });

  it('gives a rewrite its brief, and the old text from a little before where the new text stops', () => {
    const before = `${'a'.repeat(6_000)}${'b'.repeat(6_000)}`;
    const out = rewriteToCarryOn({ instruction: 'Change it.', notes: '- why' }, before, 'x'.repeat(9_000));
    expect(out.revision_brief).toBe('Change it.\n- why');
    expect(out.rest_of_current).toHaveLength(7_000);
    expect(out.rest_of_current!.startsWith('a')).toBe(true);
    expect(out.rest_of_current!.endsWith('b')).toBe(true);
  });

  it('still gives the brief when the old text is not known', () => {
    expect(rewriteToCarryOn({ instruction: 'Change it.' }, undefined, 'new')).toEqual({ revision_brief: 'Change it.' });
  });
});
