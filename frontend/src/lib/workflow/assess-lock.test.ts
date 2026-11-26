// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assessKey, assessRunFor, claimAssess, releaseAssess, reportAssess, stopAssess, whenAssessFree } from './assess-lock';

describe('one judge per Assess stage at a time (26 Nov, L-284)', () => {
  it('lets the page or Go hold a stage, not both', () => {
    const key = assessKey('p1', 'screen');
    expect(claimAssess(key, 'page', new AbortController(), 1000)).toBe(true);
    expect(claimAssess(key, 'go')).toBe(false);
    reportAssess(key, 'page', 12, 9);
    reportAssess(key, 'go', 99, 0);
    expect(assessRunFor(key)).toEqual({ by: 'page', judged: 12, left: 9, startedAt: 1000 });
    releaseAssess(key, 'go');
    expect(assessRunFor(key)?.by).toBe('page');
    releaseAssess(key, 'page');
    expect(assessRunFor(key)).toBeNull();
    expect(claimAssess(key, 'go')).toBe(true);
    releaseAssess(key, 'go');
  });

  it('stops the page\'s run through its controller, and frees waiters when it ends', async () => {
    const key = assessKey('p2', 'screen');
    const controller = new AbortController();
    claimAssess(key, 'page', controller);
    let freed = false;
    const waiting = whenAssessFree(key).then(() => {
      freed = true;
    });
    expect(stopAssess(key)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(freed).toBe(false);
    releaseAssess(key, 'page');
    await waiting;
    expect(freed).toBe(true);
    expect(stopAssess(key)).toBe(false);
  });
});
