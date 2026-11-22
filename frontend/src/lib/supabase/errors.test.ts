import { describe, expect, it, vi } from 'vitest';
import { asError, dbError, retryOnce, writeOnceMore } from './errors';

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

describe('dbError (L-271, 21 Nov: a 522 on the decision insert read "That did not work.")', () => {
  const CLOUDFLARE = '<!DOCTYPE html><html><head><title>ljasvqoyiqxlqmhjuuwb.supabase.co | 522: Connection timed out</title></head><body>…</body></html>';

  it('a gateway timeout says so, keeps its status, and may be tried again', () => {
    const e = dbError({ message: CLOUDFLARE }, 522);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('The database did not answer in time (522)');
    expect(e.status).toBe(522);
    expect(e.transient).toBe(true);
    expect(e.details).toContain('522');
  });

  it('a dropped connection is status 0 and may be tried again', () => {
    const e = dbError({ message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch', hint: '', code: '' }, 0);
    expect(e.message).toBe('The connection to the database dropped before it answered');
    expect(e.transient).toBe(true);
  });

  it('a refusal keeps its words and code, and is not tried again', () => {
    const e = dbError({ message: 'new row violates row-level security policy for table "project_facts"', code: '42501', details: null, hint: null }, 403);
    expect(e.message).toBe('new row violates row-level security policy for table "project_facts"');
    expect(e.code).toBe('42501');
    expect(e.transient).toBe(false);
  });
});

describe('writeOnceMore', () => {
  const timeout = () => dbError({ message: 'x' }, 522);

  it('writes again once when the first try timed out and did not land', async () => {
    const write = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce('ok');
    await expect(writeOnceMore(write, async () => false, 0)).resolves.toBe('ok');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('does not write again when the first try landed', async () => {
    const write = vi.fn().mockRejectedValueOnce(timeout());
    await expect(writeOnceMore(write, async () => true, 0)).resolves.toBe('landed');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a refusal, or a check that cannot be made, gives the first error back', async () => {
    const refused = dbError({ message: 'no', code: '42501' }, 403);
    await expect(writeOnceMore(vi.fn().mockRejectedValue(refused), async () => false, 0)).rejects.toBe(refused);
    const first = timeout();
    const write = vi.fn().mockRejectedValue(first);
    await expect(writeOnceMore(write, async () => { throw new Error('read failed'); }, 0)).rejects.toBe(first);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
