/**
 * FR-16: every code produces a message a person can act on, an action set that
 * applies, and — without exception — a statement of what survived.
 *
 * The last of those is the property worth a test rather than a convention.
 * `with_preserved` and `withPreserved` have existed on both sides of the wire
 * for months; what was missing was anything that made forgetting to call them
 * fail. A tenth code added without a preservation clause should turn this file
 * red on the day it lands, not the day a user redoes six sections of a book
 * they still had.
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';
import {
  ACTIONS_FOR,
  ACTION_LABEL,
  localFailure,
  preservationClause,
  stageFailure,
  type RecoveryAction,
} from './recovery';
import { classified, type ErrorCode } from '@/lib/jobs/errors';

const CODES: ErrorCode[] = [
  'insufficient_credits',
  'rate_limited',
  'context_length',
  'output_truncated',
  'function_timeout',
  'job_dead',
  'provider_unavailable',
  'invalid_request',
  'unknown',
];

/** An error shaped the way apiFetch produces one from a classified response. */
function apiError(code: ErrorCode, extra: Partial<ApiError> = {}) {
  const err = new ApiError(classified(code).message, 502, {
    code,
    technical: 'LLM error: OpenRouter API error: HTTP 402',
    ...extra,
  });
  return err;
}

const NOTHING_SAVED = { savedVersions: 0, label: 'positioning statement' };
const SIX_SAVED = { savedVersions: 6, label: 'positioning statement' };

describe('the preservation guarantee', () => {
  it.each(CODES)('%s says what was preserved', (code) => {
    const failure = stageFailure(apiError(code), NOTHING_SAVED);
    expect(failure.code).toBe(code);
    expect(failure.message).toContain('Nothing was lost —');
  });

  it.each(CODES)('%s says what was preserved when versions exist', (code) => {
    const failure = stageFailure(apiError(code), SIX_SAVED);
    expect(failure.message).toContain('Nothing was lost —');
    expect(failure.message).toContain('6 saved versions of the positioning statement');
  });

  it('names the count rather than reassuring in the abstract', () => {
    expect(preservationClause(SIX_SAVED)).toBe(
      'all 6 saved versions of the positioning statement are still there'
    );
    expect(preservationClause({ savedVersions: 1, label: 'audience list' })).toBe(
      'the saved version of the audience list is still there'
    );
  });

  it('claims only what it can show when the stage is empty', () => {
    const clause = preservationClause(NOTHING_SAVED);
    expect(clause).toBe('nothing was written, and the rest of the project is untouched');
    expect(clause).not.toContain('0 ');
  });

  it('does not double the clause the server already appended', () => {
    // The section endpoints produce the strongest version of this sentence,
    // because only they know the count. It must survive intact.
    const err = new ApiError(
      'The OpenRouter account has run out of credit, so no further sections can be generated until it is topped up. Nothing was lost — 6 of 10 sections are saved.',
      502,
      { code: 'insufficient_credits' }
    );
    const failure = stageFailure(err, NOTHING_SAVED);
    expect(failure.message).toContain('6 of 10 sections are saved');
    expect(failure.message.match(/Nothing was lost/g)).toHaveLength(1);
  });

  it('holds for a failure that never reached the server', () => {
    const failure = stageFailure(new TypeError('fetch failed'), SIX_SAVED);
    expect(failure.message).toContain('Nothing was lost —');
  });

  it('holds for a failure the client raised itself', () => {
    const failure = localFailure('Empty draft', 'The model returned nothing.', SIX_SAVED);
    expect(failure.message).toContain('Nothing was lost —');
  });
});

describe('the action set', () => {
  it.each(CODES)('%s offers technical details', (code) => {
    expect(ACTIONS_FOR[code]).toContain('details');
  });

  it.each(CODES)('%s offers only actions that exist', (code) => {
    for (const action of ACTIONS_FOR[code]) {
      expect(ACTION_LABEL[action as RecoveryAction]).toBeTruthy();
    }
  });

  it('does not offer retry where retrying is guaranteed to fail again', () => {
    // The identical prompt will overflow the identical window. Offering retry
    // here is offering a button whose only effect is to waste a round trip.
    expect(ACTIONS_FOR.context_length).not.toContain('retry');
    expect(ACTIONS_FOR.context_length).toEqual(
      expect.arrayContaining(['shorten', 'split', 'switch_model'])
    );
  });

  it('does not offer retry when there is no credit to spend', () => {
    expect(ACTIONS_FOR.insufficient_credits).not.toContain('retry');
    expect(ACTIONS_FOR.insufficient_credits).toContain('switch_model');
  });

  it('offers pause on a rate limit and resume on an interruption', () => {
    expect(ACTIONS_FOR.rate_limited).toContain('pause');
    expect(ACTIONS_FOR.function_timeout).toContain('resume');
    // "Retry" would misdescribe what happens: the lease picks the work back up
    // from where it stopped rather than starting it over.
    expect(ACTIONS_FOR.function_timeout).not.toContain('retry');
  });

  it('does not offer shorten or split where they are irrelevant', () => {
    expect(ACTIONS_FOR.rate_limited).not.toContain('shorten');
    expect(ACTIONS_FOR.provider_unavailable).not.toContain('split');
  });
});

describe('the six failures FR-16 names', () => {
  const NAMED: Array<[string, ErrorCode]> = [
    ['insufficient credits', 'insufficient_credits'],
    ['token limits', 'context_length'],
    ['output limits', 'output_truncated'],
    ['timeouts', 'function_timeout'],
    ['rate limits', 'rate_limited'],
    ['failed jobs', 'job_dead'],
  ];

  it.each(NAMED)('%s is plain language, not a status code', (_name, code) => {
    const failure = stageFailure(apiError(code), SIX_SAVED);
    expect(failure.title).not.toMatch(/\d{3}/);
    expect(failure.message).not.toMatch(/HTTP \d{3}/);
    expect(failure.message.length).toBeGreaterThan(40);
  });

  it('keeps the raw cause available without showing it', () => {
    const failure = stageFailure(apiError('insufficient_credits'), SIX_SAVED);
    expect(failure.technical).toContain('HTTP 402');
    expect(failure.message).not.toContain('HTTP 402');
  });

  it('carries a retry-after through so the retry control can say when', () => {
    const failure = stageFailure(
      apiError('rate_limited', { retryAfter: 30 } as Partial<ApiError>),
      SIX_SAVED
    );
    expect(failure.retryAfter).toBe(30);
  });
});

describe('guidance', () => {
  it('tells a user what to shorten rather than offering a button that cannot', () => {
    const failure = stageFailure(apiError('context_length'), SIX_SAVED);
    expect(failure.guidance).toMatch(/shorten/i);
    expect(failure.guidance).toMatch(/split/i);
  });
});
