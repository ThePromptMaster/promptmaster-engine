/**
 * Every row of a query, a page at a time, up to a ceiling.
 *
 * The database answers one request with at most its configured number of rows
 * (`max_rows`, 1,000 here), whatever `.limit()` asks for, and says nothing about
 * the rest. /admin asked for 10,000 and got 1,000 (6 Nov, production): the funnel
 * lost every recent start, and "only the most recent N were counted" could never
 * fire. So pages are read until one comes back empty, a page as long as the first one
 * was: this does not need to know the setting. Pages after the first go several at a time,
 * because a month of calls is tens of thousands of rows.
 *
 * The query must have a stable order, or a row can be read twice and another not at all.
 */
export interface ReadAll<T> {
  rows: T[];
  /** What stopped it, with the rows read so far. */
  error: string | null;
  /** The ceiling was reached, so there may be more. */
  capped: boolean;
}

export const READ_PAGE = 1000;
/** Pages asked for at once, after the first has shown how long a page really is. */
const READ_TOGETHER = 6;

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  ceiling: number
): Promise<ReadAll<T>> {
  if (ceiling <= 0) return { rows: [], error: null, capped: true };
  const first = await page(0, READ_PAGE - 1);
  if (first.error) return { rows: [], error: first.error.message, capped: false };
  if (!first.data?.length) return { rows: [], error: null, capped: false };
  const rows = [...(first.data as T[])];
  const size = first.data.length;
  for (let from = size; from < ceiling; ) {
    const starts = Array.from({ length: READ_TOGETHER }, (_, i) => from + i * size).filter((s) => s < ceiling);
    const pages = await Promise.all(starts.map((s) => page(s, s + size - 1)));
    for (const { data, error } of pages) {
      if (error) return { rows, error: error.message, capped: false };
      if (!data?.length) return { rows, error: null, capped: false };
      rows.push(...(data as T[]));
    }
    from += starts.length * size;
  }
  return { rows: rows.slice(0, ceiling), error: null, capped: true };
}
