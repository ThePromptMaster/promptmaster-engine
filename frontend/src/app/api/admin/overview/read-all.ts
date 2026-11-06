/**
 * Every row of a query, a page at a time, up to a ceiling.
 *
 * The database answers one request with at most its configured number of rows
 * (`max_rows`, 1,000 here), whatever `.limit()` asks for, and says nothing about
 * the rest. /admin asked for 10,000 and got 1,000 (6 Nov, production): the funnel
 * lost every recent start, and "only the most recent N were counted" could never
 * fire. So a page is read until one comes back empty, not until one comes back short:
 * this does not need to know the setting.
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

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  ceiling: number
): Promise<ReadAll<T>> {
  const rows: T[] = [];
  while (rows.length < ceiling) {
    const { data, error } = await page(rows.length, rows.length + READ_PAGE - 1);
    if (error) return { rows, error: error.message, capped: false };
    if (!data?.length) return { rows, error: null, capped: false };
    rows.push(...(data as T[]));
  }
  return { rows: rows.slice(0, ceiling), error: null, capped: true };
}
