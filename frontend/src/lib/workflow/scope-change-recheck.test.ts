/**
 * 2 Nov prod pass (decision memo, Sean's tattoo-studio shape): "drop option A
 * entirely … reserve is now $75,000". The recheck of Form the recommendation
 * removed its Option A ruling; the guard against unasked removals put it back
 * at the top, because the recheck's reason never said "drop".
 */
import { describe, expect, it } from 'vitest';
import { askedOfRecheck, keepUnasked } from './preservation';
import { appliedScopeLabel } from '@/components/workflow/chat-scope';
import { countWords } from './measurable';

const before = [
  '## Why the others lost',
  '',
  '**Option A: lease a second site.**',
  '- It needs proven demand plus newly recruited artists. Neither is in hand.',
  '',
  '# Recommendation',
  '',
  '**Start Option C now. Investigate Option B in parallel.**',
].join('\n');
const after = ['# Recommendation', '', '**Start Option C now. Investigate Option B in parallel.**'].join('\n');
const why = 'Its recommendation was judged against all three options and includes an explicit ruling on Option A, which should now compare only B and C.';
const versionAt = '2026-11-02T13:30:00.000Z';
const facts = [
  { statement: 'Under 1,000 words', created_at: '2026-11-02T13:00:00.000Z', retired_at: null },
  { statement: 'Option A (lease a second site) is dropped entirely; the memo compares only B and C.', created_at: '2026-11-02T13:38:00.000Z', retired_at: null },
  { statement: 'Budget reserve is $40,000', created_at: '2026-11-02T13:39:00.000Z', retired_at: '2026-11-02T13:40:00.000Z' },
];

describe('a recheck after a scope change keeps what the change removed out', () => {
  it('the reason alone does not say drop, so the guard put Option A back (the bug)', () => {
    const kept = keepUnasked(before, after, why);
    expect(kept.restored).toContain('**Option A: lease a second site.**');
    expect(kept.text.startsWith('**Option A')).toBe(true);
  });

  it('with the requirements recorded since the version, nothing comes back', () => {
    const asked = askedOfRecheck(why, facts, versionAt);
    expect(asked).toContain('Option A (lease a second site) is dropped entirely');
    expect(asked).not.toContain('Under 1,000 words');
    expect(asked).not.toContain('$40,000');
    const kept = keepUnasked(before, after, asked);
    expect(kept.restored).toEqual([]);
    expect(kept.text).toBe(after);
  });

  it('without a version time, or with nothing newer, the reason stands alone', () => {
    expect(askedOfRecheck(why, facts, undefined)).toBe(why);
    expect(askedOfRecheck(why, facts, '2026-11-02T14:00:00.000Z')).toBe(why);
  });
});

describe('the chat card counts words as the limit does', () => {
  it('headings are not counted, so the card and the measured limit agree', () => {
    const memo = '# Decision memo\n\n## 1. Decision\n\nStart C now and investigate B.';
    expect(countWords(memo)).toBe(6);
    expect(appliedScopeLabel('The whole document — 1074 words', memo, 'document')).toBe('The whole document — 6 words now');
  });
});
