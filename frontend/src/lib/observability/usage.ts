/**
 * FR-18: reading what a request spent off its response.
 *
 * The backend owns no user data — that is the load-bearing invariant in
 * CLAUDE.md — so it cannot write a usage row itself. What it can do is report
 * what it just spent, which it does on the `X-PromptMaster-Usage` response
 * header, and the client persists it. The same split the job drain already
 * uses: the backend generates, the Next side owns Supabase.
 *
 * The header is compact JSON with short keys, because it rides on every single
 * generation response and a verbose one would be pure overhead:
 *
 *     [{"m":"openai/gpt-4o","i":1200,"o":340,"ms":1500,"c":0.0111}]
 *
 * One entry per provider call, so a stage generation that fanned out to four
 * calls plus a repair pass reports five. That grain is deliberate — it is the
 * repair passes and the retries that get expensive when something is wrong,
 * and a single rolled-up number would hide exactly those.
 *
 * **Parsing is total and never throws.** Metering is bookkeeping attached to a
 * request the user is waiting on; a malformed header must cost us a usage row,
 * never the generation itself. Every function here degrades to "no usage" and
 * lets the response through.
 *
 * `c` is absent, not zero, when the model's price was unknown. Preserving that
 * distinction all the way to the database is the whole reason `cost_usd` is
 * nullable — see `pricing.py` and the migration.
 */

export const USAGE_HEADER = 'X-PromptMaster-Usage';
export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface UsageEvent {
  model: string;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  /** null when the model's price was not known at call time. Never 0 for that. */
  costUsd: number | null;
  promptPriceUsd: number | null;
  completionPriceUsd: number | null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parse the header. Returns `[]` for anything unexpected — never throws. */
export function parseUsageHeader(raw: string | null | undefined): UsageEvent[] {
  if (!raw) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];

  const events: UsageEvent[] = [];
  for (const entry of decoded) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const model = typeof e.m === 'string' ? e.m : '';
    const tokensIn = num(e.i);
    const tokensOut = num(e.o);
    // A call that reported no model and no tokens is noise, not a row.
    if (!model && tokensIn === 0 && tokensOut === 0) continue;
    events.push({
      model,
      tokensIn,
      tokensOut,
      elapsedMs: num(e.ms),
      costUsd: optionalNum(e.c),
      promptPriceUsd: optionalNum(e.pp),
      completionPriceUsd: optionalNum(e.cp),
    });
  }
  return events;
}

/** Total tokens across a set of events. */
export function totalTokens(events: UsageEvent[]): { in: number; out: number } {
  return events.reduce(
    (acc, e) => ({ in: acc.in + e.tokensIn, out: acc.out + e.tokensOut }),
    { in: 0, out: 0 }
  );
}

/**
 * Total cost, or null when *nothing* was priced.
 *
 * A partially priced set sums what it can — reporting null because one of five
 * calls used an unpriced model would throw away four real numbers. The count of
 * unpriced calls is returned alongside so a surface can say "plus 1 call at an
 * unknown rate" rather than quietly understating.
 */
export function totalCost(events: UsageEvent[]): { usd: number | null; unpriced: number } {
  const priced = events.filter((e) => e.costUsd !== null);
  const unpriced = events.length - priced.length;
  if (priced.length === 0) return { usd: null, unpriced };
  return { usd: priced.reduce((sum, e) => sum + (e.costUsd ?? 0), 0), unpriced };
}

/**
 * Money, rendered.
 *
 * Sub-cent amounts are the norm here — a single call is often $0.0004 — and
 * rounding those to "$0.00" makes a page of real spend look like a page of
 * zeroes. So small amounts get four decimal places and larger ones get two.
 * `null` is "unavailable", never "$0.00": see the migration's note on why a
 * zero is a lie that looks like a fact.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** `12,481` — token counts are read as magnitudes, so they get separators. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}
