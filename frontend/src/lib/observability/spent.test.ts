import { describe, expect, it } from 'vitest';

import { addCost, shownCost, spentOn, totalOf, withSpent } from './spent';
import type { UsageEvent } from './usage';

/** 31 Oct (client): "I couldn't tell whether chat messages or actions cost anything." */
const call = (costUsd: number | null): UsageEvent => ({ model: 'm', tokensIn: 1, tokensOut: 1, elapsedMs: 1, costUsd, promptPriceUsd: null, completionPriceUsd: null, attempt: 'first' });

describe('what a piece of work cost', () => {
  it('rides on the response without becoming part of its JSON', () => {
    const body = withSpent({ ok: 1 }, [call(0.002), call(0.0011)]);
    expect(JSON.stringify(body)).toBe('{"ok":1}');
    expect(spentOn(body)).toMatchObject({ unpriced: 0, calls: 2 });
    expect(spentOn(body)?.cost).toBeCloseTo(0.0031, 10);
    expect(spentOn({ ok: 1 })).toBeNull();
  });

  it('an unknown price is counted, never added as zero', () => {
    expect(totalOf([call(0.01), call(null)])).toEqual({ cost: 0.01, unpriced: 1, calls: 2 });
    expect(totalOf([call(null)])).toEqual({ cost: null, unpriced: 1, calls: 1 });
    expect(addCost(null, null)).toBeNull();
    expect(addCost(null, 0.5)).toBe(0.5);
  });

  it('is shown so a real cost never reads as $0.00', () => {
    expect(shownCost(null)).toBeNull();
    expect(shownCost(0.00004)).toBe('< $0.0001');
    expect(shownCost(0.0042)).toBe('$0.0042');
    expect(shownCost(1.374)).toBe('$1.37');
  });
});
