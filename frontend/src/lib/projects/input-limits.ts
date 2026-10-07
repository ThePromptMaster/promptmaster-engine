/**
 * How long each brief field may be — the frontend half of
 * `backend/promptmaster/limits.py`, compared by `input-limits.test.ts`.
 *
 * 5 Oct: constraints were capped at 4,000 characters on the backend and not at
 * all here, so a long constraint list saved happily and then failed every stage
 * with a 422. The caps are now abuse ceilings, and each field says so as it
 * nears one instead of the next stage saying so afterwards.
 */

export const INPUT_LIMITS = {
  objective: 60_000,
  audience: 60_000,
  constraints: 60_000,
  output_format: 60_000,
  context: 200_000,
  /** A revise request, chat instruction or stage hint. */
  instruction: 20_000,
  /**
   * What is typed into the side chat, a "Guide me" answer, or a workflow's
   * description (6 Oct, email 12: "unlimited … if feasible"). Bounded only so a
   * runaway paste is told, not failed.
   */
  message: 200_000,
} as const;

export type LimitedField = keyof typeof INPUT_LIMITS;

/** The value as it may be saved: never longer than its field allows. */
export function withinLimit(field: LimitedField, value: string): string {
  const limit = INPUT_LIMITS[field];
  return value.length > limit ? value.slice(0, limit) : value;
}

/** A counter is worth showing only once the limit is in sight. */
export const COUNTER_FROM = 0.8;

export function counterText(length: number, limit: number): string | null {
  if (length < limit * COUNTER_FROM) return null;
  const count = `${length.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`;
  return length >= limit ? `${count} — limit reached; anything past it was not kept` : count;
}
