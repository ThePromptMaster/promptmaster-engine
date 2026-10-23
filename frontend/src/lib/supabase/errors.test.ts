import { describe, expect, it, vi } from 'vitest';
import { asError, retryOnce } from './errors';

describe('asError', () => {
  it('keeps a real Error as it is', () => {
    const e = new Error('boom');
    expect(asError(e)).toBe(e);
  });

  it("reads postgrest's plain error object", () => {
    const e = asError({ message: 'agent step 1 is finished and cannot change', code: '23514', details: null, hint: null });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('agent step 1 is finished and cannot change');
    expect(e.code).toBe('23514');
  });

  it('falls back to the details, then to the fallback sentence', () => {
    expect(asError({ message: '', details: 'TypeError: Load failed' }).message).toBe('TypeError: Load failed');
    expect(asError({}, 'Go mode hit an error.').message).toBe('Go mode hit an error.');
    expect(asError(undefined, 'Go mode hit an error.').message).toBe('Go mode hit an error.');
  });
});

describe('retryOnce', () => {
  it('returns the second attempt when the first throws', async () => {
    const fn = vi.fn().mockRejectedValueOnce({ message: 'Load failed' }).mockResolvedValueOnce('ok');
    await expect(retryOnce(fn, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the second failure', async () => {
    const fn = vi.fn().mockRejectedValue({ message: 'still down' });
    await expect(retryOnce(fn, 0)).rejects.toEqual({ message: 'still down' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
