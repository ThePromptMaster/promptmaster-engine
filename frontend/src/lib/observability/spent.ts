/**
 * What a piece of work cost, as the user is shown it (31 Oct). Pure.
 *
 * The client: "I couldn't tell whether chat messages or actions cost anything.
 * Suggestion: show the cost per action or per message." Every response
 * already reports its provider calls (`X-PromptMaster-Usage`, `usage.ts`);
 * `apiFetch` keeps them on the response it returns, out of sight of JSON, and
 * a surface reads them back with `spentOn`.
 *
 * A call whose price was not known has no cost — never $0.00 (FR-18). A total
 * over such calls says how many were left out.
 */

import type { UsageEvent } from './usage';

const SPENT = Symbol.for('promptmaster.spent');

/** The response with what it cost attached; anything that is not an object is returned as it is. */
export function withSpent<T>(body: T, events: readonly UsageEvent[]): T {
  if (body && typeof body === 'object' && events.length) {
    try {
      Object.defineProperty(body, SPENT, { value: [...events], enumerable: false });
    } catch {
      // A frozen body loses its cost, not the response.
    }
  }
  return body;
}

export interface Spent {
  /** The sum over the calls whose price was known; null when none was. */
  cost: number | null;
  /** Calls whose price was not known, so not in `cost`. */
  unpriced: number;
  calls: number;
}

export function totalOf(events: readonly { costUsd: number | null }[]): Spent {
  const priced = events.filter((e) => e.costUsd !== null && Number.isFinite(e.costUsd));
  return {
    cost: priced.length ? priced.reduce((sum, e) => sum + (e.costUsd as number), 0) : null,
    unpriced: events.length - priced.length,
    calls: events.length,
  };
}

/** What a response from `api` cost, or null when it reported nothing. */
export function spentOn(response: unknown): Spent | null {
  const events = response && typeof response === 'object' ? (response as Record<symbol, unknown>)[SPENT] : undefined;
  return Array.isArray(events) && events.length ? totalOf(events as UsageEvent[]) : null;
}

/** Two amounts added; unknown stays unknown only when both are. */
export function addCost(a: number | null | undefined, b: number | null | undefined): number | null {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * An amount as a user reads it: "$0.0042", "$1.37", "under $0.0001". Never
 * "$0.00" for a call that cost something, and null — the caller says "price
 * unavailable" — for an unknown price.
 */
export function shownCost(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value <= 0) return '$0.00';
  if (value < 0.0001) return '< $0.0001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
