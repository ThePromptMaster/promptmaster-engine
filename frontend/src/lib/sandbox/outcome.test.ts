import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyRun, missingModule, truncate, type RunOutcome } from './outcome';
import { MockRunner, sandboxMode } from './runner';

const base: RunOutcome = { status: 'ok', stdout: '4\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1200 };

describe('classifyRun — PM-12: the label is what happened', () => {
  it('a clean run is executed', () => {
    expect(classifyRun(base)).toMatchObject({ stepStatus: 'succeeded', executionLabel: 'code_executed', blockKind: null });
  });

  it('a simulation that ran is simulation_run', () => {
    expect(classifyRun(base, 'simulation').executionLabel).toBe('simulation_run');
  });

  it('a nonzero exit still ran, so it is still executed', () => {
    const c = classifyRun({ ...base, status: 'error', exitCode: 1, stderr: 'ZeroDivisionError: division by zero' });
    expect(c.executionLabel).toBe('code_executed');
    expect(c.summary).toMatch(/exited with code 1/);
  });

  it('a timeout never finished, so it stays code_written', () => {
    const c = classifyRun({ ...base, status: 'timeout', exitCode: null, timedOut: true });
    expect(c).toMatchObject({ stepStatus: 'failed', executionLabel: 'code_written' });
  });

  it('an unavailable sandbox is blocked on a missing tool, not a failure', () => {
    const c = classifyRun({ ...base, status: 'unavailable', exitCode: null, detail: 'code execution is not enabled' });
    expect(c).toMatchObject({ stepStatus: 'blocked', executionLabel: 'blocked', blockKind: 'tool_missing' });
    expect(c.summary).toContain('not enabled');
  });

  it('a missing Python module is a missing tool', () => {
    const c = classifyRun({ ...base, status: 'error', exitCode: 1, stderr: "ModuleNotFoundError: No module named 'qiskit'" });
    expect(c).toMatchObject({ stepStatus: 'blocked', blockKind: 'tool_missing' });
    expect(c.summary).toContain('qiskit');
  });

  it('a missing input file is missing data', () => {
    const c = classifyRun({
      ...base, status: 'error', exitCode: 1,
      stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'measurements.csv'",
    });
    expect(c).toMatchObject({ stepStatus: 'blocked', blockKind: 'data_missing' });
  });

  it('code that ran only to say it had no data did not carry out the analysis', () => {
    // The code-writer is told to print this line; on a clean exit it used to
    // be `code_executed`, and its row was marked Completed.
    for (const exitCode of [0, 2]) {
      const c = classifyRun({ ...base, status: exitCode ? 'error' : 'ok', exitCode, stdout: 'checking inputs\nMISSING_DATA: Signup dates per account were not provided.\n' });
      expect(c).toMatchObject({ stepStatus: 'blocked', executionLabel: 'blocked', blockKind: 'data_missing', missing: 'Signup dates per account were not provided.' });
    }
    expect(classifyRun({ ...base, stdout: 'the MISSING_DATA: marker mid-line is not the signal' }).executionLabel).toBe('code_executed');
  });

  it('"status: not_run" in the code\'s own label: value lines is the same thing said differently (production, 3 Oct)', () => {
    const stdout = 'row: 4 run: Analyze billing signals\nstatus: not_run\nobserved: The attached file holds no billing fields.\n';
    const c = classifyRun({ ...base, stdout });
    expect(c).toMatchObject({ stepStatus: 'blocked', blockKind: 'data_missing', missing: 'The attached file holds no billing fields.' });
    expect(classifyRun({ ...base, stdout: 'status: "not run"\n' }).missing).toBe('the code reported that this run could not be made from the data provided');
    // A result that merely mentions the words is not a status line.
    expect(classifyRun({ ...base, stdout: 'rows_not_run: 3\nstatus: completed\n' }).executionLabel).toBe('code_executed');
    expect(classifyRun({ ...base, stdout: 'note: two runs were not_run earlier\n' }).executionLabel).toBe('code_executed');
  });

  it('a module name in stdout of a clean run does not block it', () => {
    expect(classifyRun({ ...base, stdout: "No module named 'x'" }).executionLabel).toBe('code_executed');
  });
});

describe('helpers', () => {
  it('missingModule reads the module name', () => {
    expect(missingModule("ModuleNotFoundError: No module named 'torch'")).toBe('torch');
    expect(missingModule('fine')).toBeNull();
  });

  it('truncate keeps the tail, where results and tracebacks are', () => {
    const t = truncate('a'.repeat(50) + 'RESULT', 10);
    expect(t.truncated).toBe(true);
    expect(t.text.endsWith('RESULT')).toBe(true);
    expect(truncate('short', 10)).toEqual({ text: 'short', truncated: false });
  });
});

describe('MockRunner and the production guard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('drives every branch from the code', async () => {
    const r = new MockRunner();
    expect((await r.run('print(1)')).status).toBe('ok');
    expect((await r.run('# mock:timeout')).timedOut).toBe(true);
    expect((await r.run('# mock:unavailable')).status).toBe('unavailable');
    expect(missingModule((await r.run('import nonexistent_lib')).stderr)).toBe('nonexistent_lib');
    expect(await r.run('print("MISSING_DATA: no churn records")\nraise SystemExit(2)')).toMatchObject({ exitCode: 2, stdout: 'MISSING_DATA: no churn records\n' });
  });

  it('mock mode refuses production', () => {
    vi.stubEnv('SANDBOX_MODE', 'mock');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => sandboxMode()).toThrow(/not allowed/);
  });

  it('defaults to the real sandbox', () => {
    vi.stubEnv('SANDBOX_MODE', '');
    expect(sandboxMode()).toBe('vercel');
  });
});
