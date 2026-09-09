/**
 * FR-16 in the workspace: a failed request becomes something a person can act on.
 *
 * `lib/jobs/errors.ts` already mirrors the backend taxonomy, and this builds on
 * it rather than repeating it — the codes and the plain-language copy have one
 * definition, and only one. What is added here is the two things the job drain
 * never needed:
 *
 * 1. **An action set.** FR-16 names seven — retry, shorten, split, switch
 *    configured model, resume saved progress, pause, view technical details —
 *    and which of them apply is a property of the code, not of the screen. A
 *    rate limit is not fixed by shortening anything; a context overflow is not
 *    fixed by retrying it unchanged. Offering all seven everywhere would be the
 *    same failure as offering none.
 *
 * 2. **The preservation guarantee, enforced.** `stageFailure` is the only way a
 *    classified failure reaches the workflow UI, and it cannot return one whose
 *    message does not say what survived. The backend states what it knows (it
 *    wrote nothing); this states what only the client knows (how many versions
 *    of this stage are already saved). A test asserts the property for every
 *    code, because the moment it is merely a convention someone will add a
 *    tenth code and forget.
 *
 * The reason any of this matters is narrow and concrete: a user who has paid
 * for six sections and reads "Error: 402" cannot tell whether the six still
 * exist. Redoing them is the rational response, and it is the wrong one.
 */

import { classifyDrainError, type ClassifiedError, type ErrorCode } from '@/lib/jobs/errors';

export type RecoveryAction =
  | 'retry'
  | 'resume'
  | 'shorten'
  | 'split'
  | 'switch_model'
  | 'pause'
  | 'details';

/**
 * Which of FR-16's actions apply to each failure.
 *
 * `details` is on every row: whatever went wrong, a user is entitled to see
 * the raw cause — and support is entitled to be sent it.
 */
export const ACTIONS_FOR: Record<ErrorCode, RecoveryAction[]> = {
  // Retrying spends nothing because nothing will be served. A cheaper or
  // free-tier model is the only move that can succeed from here.
  insufficient_credits: ['switch_model', 'details'],
  // Resolves itself. Retry is offered for the impatient, pause for the user
  // who would rather stop than sit through a backoff.
  rate_limited: ['retry', 'pause', 'details'],
  // The one case where retrying the identical request is guaranteed to fail
  // again, so retry is deliberately absent.
  context_length: ['shorten', 'split', 'switch_model', 'details'],
  output_truncated: ['retry', 'split', 'switch_model', 'details'],
  // Interrupted work: the lease exists for exactly this, so the honest verb is
  // resume, not retry.
  function_timeout: ['resume', 'details'],
  job_dead: ['retry', 'switch_model', 'details'],
  provider_unavailable: ['retry', 'switch_model', 'details'],
  invalid_request: ['shorten', 'switch_model', 'details'],
  unknown: ['retry', 'details'],
};

/**
 * The one-line "what usually clears this", for the actions that are advice
 * rather than buttons. Shorten and split are things only the user can do to
 * their own inputs, and a button that claims to do them would be a lie.
 */
const GUIDANCE: Partial<Record<ErrorCode, string>> = {
  context_length:
    'Shorten the objective and constraints, or split this stage’s work across two shorter passes.',
  output_truncated:
    'Ask for less in one go — split the section, or tighten the format — or pick a model with a larger output budget.',
  invalid_request: 'Shortening the objective, or choosing a different model, is the usual fix.',
  insufficient_credits: 'Topping up the account, or switching to a cheaper model, unblocks it.',
};

export interface StageFailure extends ClassifiedError {
  actions: RecoveryAction[];
  /** One line of "what usually clears this", when there is one. */
  guidance?: string;
  /** The raw cause, for the technical-details disclosure. Never shown by default. */
  technical?: string;
  /** Seconds, when the provider said so. */
  retryAfter?: number | null;
}

/**
 * What the caller can truthfully promise is still there.
 *
 * `savedVersions` is the count for the stage that failed. It is the strongest
 * claim available — the user can go and click the version pills — which is why
 * it is preferred over the general clause.
 */
export interface PreservedContext {
  /** Versions already stored for this stage. */
  savedVersions: number;
  /** Singular noun for the stage's artifact, e.g. "positioning statement". */
  label: string;
}

export function preservationClause({ savedVersions, label }: PreservedContext): string {
  if (savedVersions > 0) {
    return savedVersions === 1
      ? `the saved version of the ${label} is still there`
      : `all ${savedVersions} saved versions of the ${label} are still there`;
  }
  // Nothing on this stage yet, so the honest claim is about the project. This
  // is still worth saying: the question a failed draft raises is "did I just
  // lose something", and the answer is no.
  return 'nothing was written, and the rest of the project is untouched';
}

const PRESERVED_MARKER = 'Nothing was lost —';

/**
 * Turn any thrown value into the failure the workspace renders.
 *
 * Always returns a message containing a preservation clause. When the server
 * already appended one — every classified backend response does — it is left
 * alone rather than doubled.
 */
export function stageFailure(error: unknown, preserved: PreservedContext): StageFailure {
  const classified = classifyDrainError(error);
  const carried = error as
    | { technical?: unknown; retryAfter?: unknown; message?: unknown }
    | null
    | undefined;

  // The backend's classified message is better than the client's re-derivation
  // of it: it can name a retry-after in seconds, and the section endpoints can
  // name how many sections are saved.
  const serverMessage =
    typeof carried?.message === 'string' && carried.message.includes(PRESERVED_MARKER)
      ? carried.message
      : null;

  const base = serverMessage ?? classified.message;
  const message = base.includes(PRESERVED_MARKER)
    ? base
    : `${base} ${PRESERVED_MARKER} ${preservationClause(preserved)}.`;

  return {
    code: classified.code,
    title: classified.title,
    message,
    retryable: classified.retryable,
    actions: ACTIONS_FOR[classified.code],
    guidance: GUIDANCE[classified.code],
    technical: typeof carried?.technical === 'string' ? carried.technical : undefined,
    retryAfter: typeof carried?.retryAfter === 'number' ? carried.retryAfter : null,
  };
}

/**
 * A failure the client raised on its own, with no server involved.
 *
 * An empty draft is not a provider error and must not be dressed as one, but
 * it still owes the user the preservation clause — it is the same question.
 */
export function localFailure(
  title: string,
  message: string,
  preserved: PreservedContext,
  actions: RecoveryAction[] = ['retry']
): StageFailure {
  return {
    code: 'unknown',
    title,
    message: `${message} ${PRESERVED_MARKER} ${preservationClause(preserved)}.`,
    retryable: true,
    actions,
  };
}

export const ACTION_LABEL: Record<RecoveryAction, string> = {
  retry: 'Try again',
  resume: 'Resume from where it stopped',
  shorten: 'Shorten the inputs',
  split: 'Split the work',
  switch_model: 'Switch model',
  pause: 'Stop for now',
  details: 'Technical details',
};

export const ACTION_ICON: Record<RecoveryAction, string> = {
  retry: 'refresh',
  resume: 'play_arrow',
  shorten: 'compress',
  split: 'call_split',
  switch_model: 'swap_horiz',
  pause: 'pause',
  details: 'code',
};
