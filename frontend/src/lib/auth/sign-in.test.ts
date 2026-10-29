import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInTimeout, withTimeout } from './sign-in';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through what finishes in time, and clears its timer', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes through a failure unchanged', async () => {
    const err = new Error('Invalid login credentials');
    await expect(withTimeout(Promise.reject(err), 1000)).rejects.toBe(err);
  });

  it('gives up on a sign-in that never answers', async () => {
    vi.useFakeTimers();
    const hung = withTimeout(new Promise(() => {}), 1000);
    const caught = hung.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBeInstanceOf(SignInTimeout);
  });
});
