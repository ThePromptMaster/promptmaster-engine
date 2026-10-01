/**
 * Where code actually runs (B3). Two implementations behind one interface:
 *
 *   VercelSandboxRunner — a Firecracker microVM per run, via @vercel/sandbox.
 *     Credentials come from the project's Vercel OIDC token in production;
 *     locally, from VERCEL_OIDC_TOKEN (`vercel env pull`) or VERCEL_TOKEN +
 *     VERCEL_TEAM_ID + VERCEL_PROJECT_ID.
 *   MockRunner — SANDBOX_MODE=mock, for Playwright and CI. Never in production.
 *
 * The VM has no network while user code runs. With SANDBOX_SNAPSHOT_ID set it
 * boots from a snapshot that already holds numpy/scipy/sympy/matplotlib and is
 * deny-all from the start; without one it installs them with egress limited to
 * PyPI and then switches to deny-all before the code is written, so model-written
 * code never runs with a network.
 */

import { classifyRun, truncate, type RunOutcome } from './outcome';

export interface RunArtifact {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface RunResult extends RunOutcome {
  artifacts: RunArtifact[];
}

/** A project data file, placed read-only at /data/<name> before the code runs. */
export interface RunInputFile {
  name: string;
  bytes: Uint8Array;
}

export interface CodeRunner {
  run(code: string, opts: { timeoutMs: number; files?: RunInputFile[] }): Promise<RunResult>;
}

export const DATA_DIR = '/data';

export const STDOUT_MAX = 20_000;
export const STDERR_MAX = 8_000;
export const MAX_ARTIFACTS = 5;
export const MAX_ARTIFACT_BYTES = 1_000_000;
const PACKAGES = ['numpy', 'scipy', 'sympy', 'matplotlib'];
const WORKDIR = '/vercel/sandbox';

function unavailable(detail: string, started: number): RunResult {
  return {
    status: 'unavailable', stdout: '', stderr: '', exitCode: null, timedOut: false,
    durationMs: Date.now() - started, detail, artifacts: [],
  };
}

export class VercelSandboxRunner implements CodeRunner {
  async run(code: string, { timeoutMs, files = [] }: { timeoutMs: number; files?: RunInputFile[] }): Promise<RunResult> {
    const started = Date.now();
    let mod: typeof import('@vercel/sandbox');
    try {
      mod = await import('@vercel/sandbox');
    } catch {
      return unavailable('the sandbox SDK is not installed', started);
    }
    const snapshotId = (process.env.SANDBOX_SNAPSHOT_ID ?? '').trim();
    const token = (process.env.VERCEL_TOKEN ?? '').trim();
    const creds = token
      ? { token, teamId: process.env.VERCEL_TEAM_ID ?? '', projectId: process.env.VERCEL_PROJECT_ID ?? '' }
      : {};
    let sandbox: InstanceType<typeof mod.Sandbox> | null = null;
    try {
      sandbox = snapshotId
        ? await mod.Sandbox.create({
            ...creds, source: { type: 'snapshot', snapshotId }, timeout: 180_000,
            resources: { vcpus: 2 }, networkPolicy: 'deny-all',
          })
        : await mod.Sandbox.create({
            ...creds, runtime: 'python3.13', timeout: 180_000, resources: { vcpus: 2 },
            networkPolicy: { allow: ['pypi.org', 'files.pythonhosted.org'] },
          });
    } catch (e) {
      return unavailable(`the sandbox could not start (${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'})`, started);
    }
    try {
      if (!snapshotId) {
        const install = await sandbox.runCommand({ cmd: 'pip', args: ['install', '-q', ...PACKAGES], timeoutMs: 120_000 });
        if (install.exitCode !== 0) {
          return unavailable('the scientific Python packages could not be installed', started);
        }
      }
      await sandbox.updateNetworkPolicy('deny-all');
      await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', '/out'], sudo: true });
      await sandbox.runCommand({ cmd: 'chmod', args: ['777', '/out'], sudo: true });
      // The project's data, readable by the code and by nothing outside the VM.
      await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', DATA_DIR], sudo: true });
      await sandbox.runCommand({ cmd: 'chmod', args: ['777', DATA_DIR], sudo: true });
      await sandbox.writeFiles([
        { path: `${WORKDIR}/main.py`, content: code },
        ...files.map((f) => ({ path: `${DATA_DIR}/${f.name}`, content: f.bytes })),
      ]);

      const runStarted = Date.now();
      let timedOut = false;
      let exitCode: number | null = null;
      let stdout = '';
      let stderr = '';
      try {
        const done = await sandbox.runCommand({ cmd: 'python3', args: ['main.py'], cwd: WORKDIR, timeoutMs });
        exitCode = done.exitCode;
        [stdout, stderr] = await Promise.all([done.stdout(), done.stderr()]);
      } catch (e) {
        if (Date.now() - runStarted >= timeoutMs - 500) timedOut = true;
        else throw e;
      }
      // SIGKILL on expiry surfaces as exit 137 rather than a throw.
      if (exitCode === 137 && Date.now() - runStarted >= timeoutMs - 500) timedOut = true;

      const artifacts: RunArtifact[] = [];
      if (!timedOut) {
        const listing = await sandbox.runCommand({ cmd: 'ls', args: ['-1', '/out'] });
        const names = (await listing.stdout()).split('\n').map((n) => n.trim()).filter(Boolean).slice(0, MAX_ARTIFACTS);
        for (const name of names) {
          const buf = await sandbox.readFileToBuffer({ path: `/out/${name}` });
          if (buf && buf.byteLength <= MAX_ARTIFACT_BYTES) {
            artifacts.push({ name, contentType: contentTypeFor(name), bytes: new Uint8Array(buf) });
          }
        }
      }
      return {
        status: timedOut ? 'timeout' : exitCode === 0 ? 'ok' : 'error',
        stdout, stderr, exitCode: timedOut ? null : exitCode, timedOut,
        durationMs: Date.now() - runStarted, artifacts,
      };
    } catch (e) {
      return unavailable(`the sandbox failed while running (${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'})`, started);
    } finally {
      await sandbox.stop().catch(() => undefined);
    }
  }
}

export function contentTypeFor(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

/**
 * Scripted execution for tests. The code decides the outcome, so an E2E can
 * drive each branch from the objective text via the mock LLM:
 *   # mock:unavailable   → the sandbox is down
 *   # mock:timeout       → never finishes
 *   import <missing>     → ModuleNotFoundError
 *   otherwise            → prints each `print(f"… = {…}")` line with a fixed value
 */
export class MockRunner implements CodeRunner {
  async run(code: string, opts?: { timeoutMs: number; files?: RunInputFile[] }): Promise<RunResult> {
    const files = opts?.files ?? [];
    if (code.includes('# mock:unavailable') || process.env.SANDBOX_MOCK_UNAVAILABLE === '1') {
      return unavailable('the code sandbox is not enabled for this deployment (mock)', Date.now());
    }
    if (code.includes('# mock:timeout')) {
      return { status: 'timeout', stdout: '', stderr: '', exitCode: null, timedOut: true, durationMs: 30_000, artifacts: [] };
    }
    const missing = /^\s*import (nonexistent_\w+)/m.exec(code)?.[1];
    if (missing) {
      return {
        status: 'error', stdout: '', exitCode: 1, timedOut: false, durationMs: 40, artifacts: [],
        stderr: `Traceback (most recent call last):\n  File "main.py", line 1, in <module>\nModuleNotFoundError: No module named '${missing}'`,
      };
    }
    // Code that reads /data is told what was actually put there, so a test
    // can see the project's files reached the run — or that none did.
    if (code.includes(DATA_DIR)) {
      const listing = files.length
        ? files.map((f) => `${f.name}: ${new TextDecoder().decode(f.bytes).split(/\r?\n/).filter((l) => l.trim()).length - 1} rows`).join('\n')
        : 'no data files';
      return { status: 'ok', stdout: `${listing}\n`, stderr: '', exitCode: 0, timedOut: false, durationMs: 150, artifacts: [] };
    }
    return { status: 'ok', stdout: '2 + 2 = 4\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 120, artifacts: [] };
  }
}

export function sandboxMode(): 'mock' | 'vercel' {
  const mode = (process.env.SANDBOX_MODE ?? '').trim();
  if (mode === 'mock') {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('SANDBOX_MODE=mock is not allowed in production.');
    }
    return 'mock';
  }
  return 'vercel';
}

export function makeRunner(): CodeRunner {
  return sandboxMode() === 'mock' ? new MockRunner() : new VercelSandboxRunner();
}

export { classifyRun, truncate };
