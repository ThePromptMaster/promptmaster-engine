import { describe, expect, it, vi } from 'vitest';

import { sectionWaitProgress } from './perform';

describe("Go's wait for sections (27 Nov pass)", () => {
  it('counts this pass only, so a rewrite of written chapters starts at 0, and refreshes as they land', () => {
    let t = 0;
    const lines: string[] = [];
    const refresh = vi.fn();
    const onProgress = sectionWaitProgress(3, (l) => lines.push(l), refresh, () => t);
    onProgress({ written: [] });
    expect(lines.at(-1)).toBe('0 of 3 sections written');
    expect(refresh).not.toHaveBeenCalled();
    t = 25_000;
    onProgress({ written: ['a'] });
    expect(lines.at(-1)).toBe('1 of 3 sections written');
    expect(refresh).toHaveBeenCalledTimes(1);
    // A second section 5 s later waits for the 20 s spacing; the third, later, refreshes again.
    t = 30_000;
    onProgress({ written: ['a', 'b'] });
    expect(refresh).toHaveBeenCalledTimes(1);
    t = 52_000;
    onProgress({ written: ['a', 'b', 'c'] });
    expect(lines.at(-1)).toBe('3 of 3 sections written');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
