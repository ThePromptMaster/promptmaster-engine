/**
 * Out of model credit is not a repair that failed (8 Nov, production: two
 * repairs refused for credit ended the run as "the last 2 steps failed", and
 * each counted as a try). The run stops at once and says so; the step counts
 * as cut off, so it costs no try and Resume picks up the same work. Pure.
 */

export const OUT_OF_CREDITS = 'insufficient_credits';

export function isOutOfCredits(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === OUT_OF_CREDITS;
}

/** The step's outcome when credit ran out: cut off, with the run stopped on the reason. */
export function creditStop(message: string, changes: Record<string, unknown> = {}) {
  return {
    status: 'interrupted' as const,
    label: null,
    toolsUsed: [] as string[],
    changes,
    output: message,
    stop: { status: 'blocked' as const, reason: message },
  };
}
