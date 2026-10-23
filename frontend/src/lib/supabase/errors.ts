/**
 * What a Supabase call threw, as an `Error` that says what went wrong.
 *
 * The data helpers here `throw error` straight from postgrest-js, whose error
 * is a plain `{ message, code, details, hint }` object rather than an `Error`.
 * Anything that tested `e instanceof Error` fell back to a generic sentence, so
 * a refused write, an RLS denial and a phone dropping its connection all read
 * "Go mode hit an error." (client, 21 Oct) and nothing said which.
 */

export interface DataError extends Error {
  code?: string;
  details?: string;
  hint?: string;
}

export function asError(e: unknown, fallback = 'Something went wrong.'): DataError {
  if (e instanceof Error) {
    if (!e.message.trim()) e.message = fallback;
    return e;
  }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const text = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
    const err: DataError = new Error(text('message') ?? text('details') ?? fallback);
    err.code = text('code');
    err.details = text('details');
    err.hint = text('hint');
    return err;
  }
  if (typeof e === 'string' && e.trim()) return new Error(e.trim());
  return new Error(fallback);
}

/** Calls `fn`, and once more after `delayMs` if it throws — for a write a dropped connection should not lose. */
export async function retryOnce<T>(fn: () => Promise<T>, delayMs = 800): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}
