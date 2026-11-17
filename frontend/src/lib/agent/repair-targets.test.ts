import { describe, expect, it } from 'vitest';
import { changeTerms, repairWaitMs, sectionExcerpt } from './repair-targets';

describe('what a reason says changed', () => {
  it('quoted phrases and the chapters it names, never an apostrophe', () => {
    const terms = changeTerms('The drafted manuscript\'s Chapter 5 section carries the old title, which must change to \'Beyond the Growth Narrative\'.', []);
    expect(terms).toContain('Beyond the Growth Narrative');
    expect(terms).toContain('Chapter 5');
    expect(terms.some((t) => t.startsWith('s Chapter'))).toBe(false);
  });

  it('double and curly quotes, and the replaced values', () => {
    const terms = changeTerms('Retitle it “Beyond the Growth Narrative” and say "Section 5".', [{ was: 'Section 4', now: 'Section 5', value: '4' }]);
    expect(terms).toEqual(expect.arrayContaining(['Beyond the Growth Narrative', 'Section 5', 'Section 4']));
  });
});

describe('a section as the check sees it', () => {
  it('its opening and the sentences that mention what changed', () => {
    const text = `${'Opening words. '.repeat(30)}Later the book calls this "The Growth Story". Nothing else here.`;
    const out = sectionExcerpt(text, ['Growth Story']);
    expect(out).toMatch(/^Opening: Opening words\./);
    expect(out).toContain('Mentions: Later the book calls this "The Growth Story".');
    expect(out).not.toContain('Nothing else here');
  });

  it('says so when nothing mentions it', () => {
    expect(sectionExcerpt('A short section.', ['Growth Story'])).toBe('Opening: A short section.\nMentions: none of what changed.');
  });
});

describe('how long a repair waits', () => {
  it('ten minutes and two and a half a section, at most ninety', () => {
    expect(repairWaitMs(0)).toBe(10 * 60_000);
    expect(repairWaitMs(2)).toBe(15 * 60_000);
    expect(repairWaitMs(26)).toBe(75 * 60_000);
    expect(repairWaitMs(100)).toBe(90 * 60_000);
  });
});
