import type { ExampleKey } from './cards';

/**
 * What a real production run of each example produced, for its preview page: a
 * visitor sees what they would get with no account and no spend (the client's call,
 * 4 Nov). Copied from the run as it finished, in English, with its date, because
 * a sample of output that was tidied afterwards would be a promise, not a record.
 */
export interface FinishedResult {
  /** The day of the run (ISO). */
  date: string;
  /** Rounded, from the project page when the run finished. */
  minutes: number;
  costUsd: number;
  /** The deliverable as the run left it, in Markdown. */
  text: string;
}

export const FINISHED_RESULTS: Partial<Record<ExampleKey, FinishedResult>> = {};
