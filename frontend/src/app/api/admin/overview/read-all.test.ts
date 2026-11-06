import { describe, expect, it } from 'vitest';

import { READ_PAGE, readAll } from './read-all';

/** A table behind a cap: one request returns at most `cap` rows, whatever is asked for. */
function table(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { page, asked };
}

describe('readAll', () => {
  it('reads past the cap on one response', async () => {
    const { page } = table(2500, 1000);
    const { rows, capped, error } = await readAll<number>(page, 10_000);
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toBe(2499);
    expect(capped).toBe(false);
    expect(error).toBeNull();
  });

  it('does not depend on what the cap is set to', async () => {
    const { page } = table(2500, 300);
    expect((await readAll<number>(page, 10_000)).rows).toHaveLength(2500);
  });

  it('says so when the ceiling is what stopped it', async () => {
    const { page } = table(2500, 1000);
    const { rows, capped } = await readAll<number>(page, 2000);
    expect(rows).toHaveLength(2000);
    expect(capped).toBe(true);
  });

  it('is not capped when the rows end exactly at the ceiling minus nothing further', async () => {
    const { page } = table(READ_PAGE, READ_PAGE);
    const { rows, capped } = await readAll<number>(page, 10_000);
    expect(rows).toHaveLength(READ_PAGE);
    expect(capped).toBe(false);
  });

  it('keeps what it read when a later page fails', async () => {
    let calls = 0;
    const { rows, error } = await readAll<number>(async () => {
      calls += 1;
      return calls === 1 ? { data: [1, 2], error: null } : { data: null, error: { message: 'boom' } };
    }, 10_000);
    expect(rows).toEqual([1, 2]);
    expect(error).toBe('boom');
  });
});
