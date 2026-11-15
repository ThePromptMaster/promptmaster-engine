// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { cutText, errorMessage, storableText, storableValue, wellFormed } from './clean-text';

const x = '\u{1D465}'; // 𝑥, two UTF-16 units

describe('text the database will store (15 Nov, a physics paper broke project creation)', () => {
  it('drops NUL and control characters but keeps tabs and line breaks', () => {
    expect(storableText('a\u0000b\u0001c\td\ne\u007f')).toBe('abc\td\ne');
  });

  it('replaces a lone half of a surrogate pair and keeps whole pairs', () => {
    expect(wellFormed(`${x}\uD835`)).toBe(`${x}�`);
    expect(wellFormed(`\uDC65${x}`)).toBe(`�${x}`);
    expect(storableText(`E = m${x}`)).toBe(`E = m${x}`);
  });

  it('never cuts between the two halves of a pair', () => {
    const text = x.repeat(5);
    expect(cutText(text, 3)).toBe(x);
    expect(cutText(text, 4)).toBe(x + x);
    expect(JSON.stringify(cutText(text, 3))).not.toMatch(/\\ud8/);
    expect(cutText('abc', 10)).toBe('abc');
    expect(cutText('abc', 0)).toBe('');
  });

  it('cleans every string inside a JSON value', () => {
    expect(storableValue({ a: 'x\u0000', b: [{ c: '\uD835' }], n: 3, ok: true })).toEqual({ a: 'x', b: [{ c: '�' }], n: 3, ok: true });
  });

  it("reads Supabase's plain error objects, which are not Errors", () => {
    expect(errorMessage({ message: 'unsupported Unicode escape sequence', code: '22P05' })).toBe('unsupported Unicode escape sequence');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(null)).toBe('');
  });
});
