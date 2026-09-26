import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyDrainError } from './errors';
import { GeneratorError, HttpSectionGenerator } from './generator';

/**
 * The drain's HTTP client. Nothing tested it: the drain tests inject a fake
 * generator, which is how PM-04's misclassification went unseen.
 */

const SECTION_REQ = {
  inputs: { objective: 'o', audience: '', constraints: '', output_format: '', mode: 'architect' as const },
  outline: [],
  section_index: 0,
  records: [],
  prev_section_content: '',
  model: '',
  userId: 'u1',
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => vi.unstubAllGlobals());

describe('HttpSectionGenerator errors', () => {
  it('keeps the backend’s classification, so an out-of-credits error is not retried', async () => {
    vi.stubGlobal(
      'fetch',
      respond(502, {
        detail: {
          code: 'insufficient_credits',
          title: 'Out of model credits',
          message: 'The OpenRouter account has run out of credit.',
          retryable: false,
        },
      })
    );
    const error = await new HttpSectionGenerator('secret').generateSectionProse(SECTION_REQ).catch((e) => e);

    expect(error).toBeInstanceOf(GeneratorError);
    expect(error.code).toBe('insufficient_credits');
    // Before: code-less, so status 502 classified as provider_unavailable — retryable.
    expect(classifyDrainError(error)).toMatchObject({ code: 'insufficient_credits', retryable: false });
  });

  it('still reads a plain string detail', async () => {
    vi.stubGlobal('fetch', respond(400, { detail: 'section_index 4 out of range' }));
    const error = await new HttpSectionGenerator('secret').generateSectionProse(SECTION_REQ).catch((e) => e);
    expect(error.message).toBe('section_index 4 out of range');
    expect(error.code).toBeUndefined();
  });
});

describe('HttpSectionGenerator time budget', () => {
  it('tells the backend how long it may take, less headroom for the response', async () => {
    const fetch = respond(200, { content: 'x', finish_reason: 'stop' });
    vi.stubGlobal('fetch', fetch);
    const generator = new HttpSectionGenerator('secret');
    generator.setTimeBudget(60_000);
    await generator.generateSectionProse(SECTION_REQ);

    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.budget_seconds).toBe(55);
  });

  it('never allows a call longer than its own ceiling, whatever the budget', async () => {
    const fetch = respond(200, { content: 'x', finish_reason: 'stop' });
    vi.stubGlobal('fetch', fetch);
    const generator = new HttpSectionGenerator('secret', 150_000);
    generator.setTimeBudget(900_000);
    await generator.generateSectionProse(SECTION_REQ);

    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.budget_seconds).toBe(145);
  });

  it('reports running out of the run’s time as function_timeout, a pause rather than a failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            );
          })
      )
    );
    const generator = new HttpSectionGenerator('secret', 150_000);
    generator.setTimeBudget(20_000);
    const pending = generator.generateSectionProse(SECTION_REQ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_001);
    const error = await pending;
    vi.useRealTimers();

    expect(error.code).toBe('function_timeout');
    expect(classifyDrainError(error).code).toBe('function_timeout');
  });
});
