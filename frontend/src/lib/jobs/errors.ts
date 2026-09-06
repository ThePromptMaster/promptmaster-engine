/**
 * FR-16 on the client: a failure the user can act on, and one that always says
 * what survived.
 *
 * This mirrors `backend/promptmaster/errors.py` rather than importing it — they
 * are separate deploy units. The backend classifies what it sees from
 * OpenRouter; this classifies what the drain sees, which includes two states the
 * backend never observes (a job buried at max_attempts, and a lease reaped
 * because the function was killed).
 *
 * The rule both halves enforce: **every message says what was preserved**. A
 * user six sections into a book who sees "Error: 402" has no idea whether those
 * six sections still exist. They do, and the message has to say so — that is the
 * difference between a recoverable pause and an apparent data loss.
 */

export type ErrorCode =
  | 'insufficient_credits'
  | 'rate_limited'
  | 'context_length'
  | 'output_truncated'
  | 'function_timeout'
  | 'job_dead'
  | 'provider_unavailable'
  | 'invalid_request'
  | 'unknown';

export interface ClassifiedError {
  code: ErrorCode;
  title: string;
  message: string;
  /** Whether another attempt could plausibly succeed with no user action. */
  retryable: boolean;
}

const TABLE: Record<ErrorCode, Omit<ClassifiedError, 'code'>> = {
  insufficient_credits: {
    title: 'Out of model credits',
    message:
      'The OpenRouter account has run out of credit, so no further sections can be generated until it is topped up.',
    retryable: false,
  },
  rate_limited: {
    title: 'Rate limited by the model provider',
    message: 'Too many requests went out too quickly. Drafting will resume on its own shortly.',
    retryable: true,
  },
  context_length: {
    title: 'The prompt was too long for this model',
    message:
      "This section's context exceeded the model's limit. Shortening the outline abstracts, or choosing a model with a larger context window, will clear it.",
    retryable: false,
  },
  output_truncated: {
    title: 'A section was cut short',
    message:
      'The model reached its output limit mid-sentence. Regenerating that one section usually completes it.',
    retryable: true,
  },
  function_timeout: {
    title: 'Paused — the run hit its time limit',
    message:
      'Generation stopped partway through and will pick up automatically from where it left off.',
    retryable: true,
  },
  job_dead: {
    title: 'Gave up on this section',
    message:
      'This section failed repeatedly, so automatic retrying has stopped. Retry it by hand once the underlying problem is fixed.',
    retryable: false,
  },
  provider_unavailable: {
    title: 'The model provider is having trouble',
    message: 'This is on their side, not yours. Trying again shortly usually works.',
    retryable: true,
  },
  invalid_request: {
    title: 'The request was rejected',
    message:
      'The model provider refused this request. Changing the model or shortening the objective is the usual fix.',
    retryable: false,
  },
  unknown: {
    title: 'Generation failed',
    message: 'Something went wrong while generating. Retrying is safe.',
    retryable: true,
  },
};

export function classified(code: ErrorCode): ClassifiedError {
  return { code, ...TABLE[code] };
}

/**
 * Classify a failure raised while draining.
 *
 * The backend already classified whatever OpenRouter said and put the code in
 * its `detail`, so the common path is to read it back rather than re-derive it
 * from an HTTP status that has been through two hops.
 */
export function classifyDrainError(error: unknown): ClassifiedError {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code in TABLE) {
      return classified(code as ErrorCode);
    }
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      if (status === 402) return classified('insufficient_credits');
      if (status === 429) return classified('rate_limited');
      if (status >= 500) return classified('provider_unavailable');
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  const lowered = message.toLowerCase();
  if (lowered.includes('credit') || message.includes('402')) return classified('insufficient_credits');
  if (lowered.includes('rate limit') || message.includes('429')) return classified('rate_limited');
  if (lowered.includes('context') && lowered.includes('length')) return classified('context_length');
  if (lowered.includes('timed out') || lowered.includes('timeout') || lowered.includes('fetch failed')) {
    return classified('provider_unavailable');
  }
  return classified('unknown');
}

/**
 * Append the reassurance clause. This is the FR-16 requirement, and the reason
 * it takes counts rather than a prewritten string is that the caller must not be
 * able to forget them.
 *
 * Passing a total of 0 yields no clause: claiming "0 of 0 sections are saved"
 * is noise, and claiming preservation we cannot demonstrate would be worse than
 * saying nothing.
 */
export function withPreserved(
  error: ClassifiedError,
  sectionsComplete: number,
  sectionsTotal: number
): ClassifiedError {
  if (sectionsTotal <= 0) return error;
  return {
    ...error,
    message: `${error.message} Nothing was lost — ${sectionsComplete} of ${sectionsTotal} sections are saved.`,
  };
}
