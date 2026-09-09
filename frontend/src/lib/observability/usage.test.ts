/**
 * FR-18: reading usage off a response, and rendering it honestly.
 *
 * Two properties under test, and the second is the one with teeth.
 *
 * **Parsing never throws.** Metering is bookkeeping bolted onto a request the
 * user is waiting for. A malformed header must cost a usage row and nothing
 * else — never the generation itself — so every input that could plausibly
 * arrive is asserted to degrade to `[]`.
 *
 * **Unknown cost stays unknown.** `null` must survive parsing, summing and
 * formatting without ever becoming `0`. The migration says why at length: a
 * zero is a lie that looks like a fact, and on a cost page a believed lie is
 * worse than a blank.
 */

import { describe, expect, it } from 'vitest';

import {
  formatTokens,
  formatUsd,
  parseUsageHeader,
  totalCost,
  totalTokens,
} from './usage';

const ONE = JSON.stringify([{ m: 'openai/gpt-4o', i: 1200, o: 340, ms: 1500, c: 0.0111 }]);

describe('parseUsageHeader', () => {
  it('reads a call with its tokens and cost', () => {
    expect(parseUsageHeader(ONE)).toEqual([
      {
        model: 'openai/gpt-4o',
        tokensIn: 1200,
        tokensOut: 340,
        elapsedMs: 1500,
        costUsd: 0.0111,
        promptPriceUsd: null,
        completionPriceUsd: null,
      },
    ]);
  });

  it('reads one entry per provider call', () => {
    const raw = JSON.stringify([
      { m: 'a', i: 10, o: 5 },
      { m: 'a', i: 20, o: 7 },
      { m: 'b', i: 1, o: 1 },
    ]);
    expect(parseUsageHeader(raw)).toHaveLength(3);
  });

  it('keeps the price snapshot when the backend sent one', () => {
    const raw = JSON.stringify([{ m: 'a', i: 1, o: 1, pp: 0.000005, cp: 0.000015 }]);
    const [event] = parseUsageHeader(raw);
    expect(event.promptPriceUsd).toBe(0.000005);
    expect(event.completionPriceUsd).toBe(0.000015);
  });

  it('keeps an absent cost as null, not zero', () => {
    const [event] = parseUsageHeader(JSON.stringify([{ m: 'a', i: 1, o: 1 }]));
    expect(event.costUsd).toBeNull();
  });

  it('keeps a genuine zero cost as zero', () => {
    // A free model really did cost nothing, and that is not the same fact as
    // "we do not know what it cost".
    const [event] = parseUsageHeader(JSON.stringify([{ m: 'free', i: 1, o: 1, c: 0 }]));
    expect(event.costUsd).toBe(0);
  });

  it.each([
    ['absent', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not json', 'not-json-at-all'],
    ['a json object', '{"m":"a"}'],
    ['a json string', '"hello"'],
    ['a json number', '42'],
    ['truncated json', '[{"m":"a",'],
  ])('degrades to no usage for a header that is %s', (_label, raw) => {
    expect(parseUsageHeader(raw as string | null)).toEqual([]);
  });

  it('skips entries that are not objects', () => {
    const raw = JSON.stringify([null, 'x', 5, { m: 'a', i: 1, o: 1 }]);
    expect(parseUsageHeader(raw)).toHaveLength(1);
  });

  it('skips an entry that reports nothing at all', () => {
    expect(parseUsageHeader(JSON.stringify([{}]))).toEqual([]);
  });

  it('coerces a non-numeric token count to zero rather than NaN', () => {
    const [event] = parseUsageHeader(JSON.stringify([{ m: 'a', i: 'lots', o: 5 }]));
    expect(event.tokensIn).toBe(0);
    expect(event.tokensOut).toBe(5);
  });
});

describe('totals', () => {
  const events = parseUsageHeader(
    JSON.stringify([
      { m: 'a', i: 100, o: 50, c: 0.01 },
      { m: 'a', i: 200, o: 60, c: 0.02 },
      { m: 'unpriced', i: 300, o: 70 },
    ])
  );

  it('sums tokens across every call', () => {
    expect(totalTokens(events)).toEqual({ in: 600, out: 180 });
  });

  it('sums what it can and reports what it could not', () => {
    // Returning null because one of three calls was unpriced would throw away
    // two real numbers; silently omitting it would understate invisibly.
    expect(totalCost(events)).toEqual({ usd: 0.03, unpriced: 1 });
  });

  it('reports null only when nothing at all was priced', () => {
    const none = parseUsageHeader(JSON.stringify([{ m: 'a', i: 1, o: 1 }]));
    expect(totalCost(none)).toEqual({ usd: null, unpriced: 1 });
  });

  it('handles an empty set', () => {
    expect(totalTokens([])).toEqual({ in: 0, out: 0 });
    expect(totalCost([])).toEqual({ usd: null, unpriced: 0 });
  });
});

describe('formatUsd', () => {
  it('renders unknown as a dash, never as $0.00', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });

  it('renders a genuine zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('gives sub-cent amounts enough precision to be visible', () => {
    // A page of real spend rounded to two places is a page of $0.00.
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.0099)).toBe('$0.0099');
  });

  it('renders ordinary amounts to two places', () => {
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0.01)).toBe('$0.01');
  });
});

describe('formatTokens', () => {
  it('separates thousands', () => {
    expect(formatTokens(12481)).toBe('12,481');
  });

  it('renders unknown as a dash', () => {
    expect(formatTokens(null)).toBe('—');
  });

  it('renders zero as zero', () => {
    expect(formatTokens(0)).toBe('0');
  });
});
