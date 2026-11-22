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

/**
 * A database write's error with its HTTP status, for a write that may be tried
 * again (L-271). supabase-js returns the status beside the error, not on it, and
 * when the gateway times out the error's message is Cloudflare's HTML page
 * (21 Nov, Sean: "Approve Option B at $60,000" was a 522 on the `project_facts`
 * insert, the only failed request in two hours, and the card said only "That did
 * not work."). Keeps what a caller may test (`code`, `status`) and what an error
 * report needs, and says whether a second try may pass.
 */
export interface DbError extends DataError {
  /** PostgREST's or Postgres's code: "23505", "PGRST116", … Empty for a gateway or network failure. */
  code: string;
  /** The HTTP status; 0 when the request never got an answer. */
  status: number;
  details: string;
  /** The gateway timed out, the server failed, or the connection dropped: the same write may work again. */
  transient: boolean;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** An HTML error page, or a message too long to be meant for a person. */
function unreadable(message: string): boolean {
  return /<\s*(?:!doctype|html|head|body)\b/i.test(message) || message.length > 400;
}

/** Whether a failure is one a second try may get past. */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** The error a write returned, as an `Error`; `status` is the response's. */
export function dbError(error: unknown, status?: number): DbError {
  if (error instanceof Error && 'transient' in error) return error as DbError;
  const raw = (error ?? {}) as Record<string, unknown>;
  const fetchFailed = /^(?:TypeError|FetchError|AbortError)\b/.test(asText(raw.message));
  const known = typeof status === 'number' ? status : fetchFailed ? 0 : -1;
  const transient = known >= 0 ? isTransientStatus(known) : fetchFailed;
  const said = asText(raw.message).trim();
  let message: string;
  if (known === 0 || fetchFailed) message = 'The connection to the database dropped before it answered';
  else if (transient) message = `The database did not answer in time (${known})`;
  else if (!said || unreadable(said)) message = known > 0 ? `The database refused the change (${known})` : 'The database refused the change';
  else message = said.replace(/\.$/, '');
  const out = new Error(message) as DbError;
  out.name = 'DbError';
  out.code = asText(raw.code);
  out.status = known < 0 ? 0 : known;
  out.details = [asText(raw.details), asText(raw.hint)].filter(Boolean).join(' · ').slice(0, 2000) || (unreadable(said) ? said.slice(0, 300) : '');
  out.hint = asText(raw.hint) || undefined;
  out.transient = transient;
  return out;
}

/** What an error report keeps of a database error. */
export function dbErrorTechnical(e: unknown): string {
  if (e && typeof e === 'object' && 'transient' in e) {
    const d = e as DbError;
    return JSON.stringify({ message: d.message, code: d.code, status: d.status, details: d.details });
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e ?? null).slice(0, 2000);
}

/**
 * A write tried once more when the first try failed in a way that may pass,
 * and only after checking it did not land: a gateway can time out after the
 * database has committed, and a decision recorded twice is two current facts.
 * Anything else, or a check that cannot be made, gives back the first error.
 */
export async function writeOnceMore<T>(
  write: () => Promise<T>,
  landed: () => Promise<boolean>,
  pauseMs = 1500
): Promise<T | 'landed'> {
  try {
    return await write();
  } catch (first) {
    if (!(first && typeof first === 'object' && (first as Partial<DbError>).transient)) throw first;
    let there: boolean;
    try {
      there = await landed();
    } catch {
      throw first;
    }
    if (there) return 'landed';
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    return write();
  }
}
