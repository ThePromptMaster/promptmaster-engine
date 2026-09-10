/**
 * FR-19: the drain leaves a trace.
 *
 * Before this, `src/lib/jobs/` and `src/app/api/` contained zero `console.*`
 * calls between them. The `DrainReport` went into the HTTP response body and
 * the only production caller is Vercel Cron, which discards it — so the
 * component that spends the most money and runs unattended left no evidence it
 * had ever run.
 *
 * Two things are asserted, and the second is the one that would otherwise rot.
 *
 * 1. The lines exist, are valid JSON, and carry the fields an operator needs to
 *    join them to a job and an error code.
 * 2. **No line carries user content.** Job payloads hold the objective, the
 *    constraints and the session facts — the user's own work. A log that leaks
 *    those turns a diagnostic convenience into a confidentiality problem, and
 *    the leak would arrive quietly the day someone spreads `...payload` into a
 *    log call because it was easier than picking fields.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainLog, stepRequestId } from './log';

const SECRET = 'the objective is to overthrow the tea monopoly';

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let priorVitest: string | undefined;
let priorNodeEnv: string | undefined;

beforeEach(() => {
  // The logger is quiet under test by design, so these tests deliberately turn
  // it back on — otherwise they would assert on a no-op and pass forever.
  priorVitest = process.env.VITEST;
  priorNodeEnv = process.env.NODE_ENV;
  delete process.env.VITEST;
  // NODE_ENV is typed readonly by @types/node, so this goes through the record
  // rather than the typed accessor. It is restored in afterEach.
  setNodeEnv('production');

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  if (priorVitest === undefined) delete process.env.VITEST;
  else process.env.VITEST = priorVitest;
  setNodeEnv(priorNodeEnv);
});

function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

function emitted(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string));
}

describe('drainLog', () => {
  it('writes one JSON object per line', () => {
    drainLog('info', { event: 'drain_completed', claimed: 2, completed: 2 });

    const [line] = emitted(logSpy);
    expect(line.event).toBe('drain_completed');
    expect(line.level).toBe('INFO');
    expect(line.logger).toBe('jobs.drain');
    expect(typeof line.ts).toBe('string');
  });

  it('carries the fields needed to join a line to a job', () => {
    drainLog('error', {
      event: 'job_failed',
      jobId: 'job-7',
      projectId: 'proj-3',
      code: 'insufficient_credits',
      attempts: 3,
    });

    const [line] = emitted(errorSpy);
    expect(line.jobId).toBe('job-7');
    expect(line.projectId).toBe('proj-3');
    expect(line.code).toBe('insufficient_credits');
  });

  it('routes warnings and errors to the error stream', () => {
    // So they can be alerted on separately from the per-drain chatter.
    drainLog('warn', { event: 'leases_reaped', count: 2 });
    drainLog('error', { event: 'job_failed' });
    drainLog('info', { event: 'drain_completed' });

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent under test by default', () => {
    process.env.VITEST = '1';
    drainLog('info', { event: 'drain_completed' });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('never logs anything a caller did not explicitly name', () => {
    // The guard against `...payload` reaching a log line.
    drainLog('info', { event: 'job_started', jobId: 'j-1' });

    const serialised = JSON.stringify(emitted(logSpy));
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('objective');
    expect(serialised).not.toContain('session_facts');
  });
});

describe('stepRequestId', () => {
  it('is derived from the job, so a line is identifiable on its own', () => {
    expect(stepRequestId('7f21c9a4-0000-1111-2222-333344445555', 'prose')).toContain('7f21c9a4');
  });

  it('differs between two attempts at the same step', () => {
    // Otherwise a retry collapses onto the first attempt's id, and the log
    // shows one request that somehow spent twice.
    const first = stepRequestId('job-1', 'prose');
    const second = stepRequestId('job-1', 'prose');
    expect(first).not.toBe(second);
  });

  it('produces a header-safe token', () => {
    expect(stepRequestId('job-1', '/api/generate-section-prose')).toMatch(/^[A-Za-z0-9]+$/);
  });
});
