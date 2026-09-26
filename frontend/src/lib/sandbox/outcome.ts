/**
 * What a code run honestly earns (PM-12). Pure, so every branch is tested
 * without a sandbox.
 *
 * The rule the whole of B3 exists to keep: a step is `code_executed` only when
 * code actually ran and exited. Sean, Sep 10: "discussed, designed, code
 * written, code executed, simulation run, result interpreted, blocked" are
 * different claims. A nonzero exit still ran, so it is still executed — the
 * interpretation explains the error. A timeout never finished, so the step
 * keeps `code_written`. A sandbox that could not start, or code needing a
 * library it does not have, is blocked on a missing tool, never "failed
 * quietly". The database checks the same thing again (agent_steps_label_honest).
 */

import type { BlockKind, ExecutionLabel } from '@/types/agent';

export type SandboxStatus = 'ok' | 'error' | 'timeout' | 'unavailable';

export interface RunOutcome {
  status: SandboxStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Why the sandbox could not run at all, for `unavailable`. */
  detail?: string;
}

export interface Classification {
  stepStatus: 'succeeded' | 'failed' | 'blocked';
  executionLabel: ExecutionLabel;
  blockKind: BlockKind | null;
  /** One line for the step timeline. */
  summary: string;
}

const MISSING_MODULE = /ModuleNotFoundError: No module named '([^']+)'/;
const MISSING_FILE = /FileNotFoundError: \[Errno 2\] No such file or directory: '([^']+)'/;

export function missingModule(stderr: string): string | null {
  return MISSING_MODULE.exec(stderr)?.[1] ?? null;
}

export function classifyRun(outcome: RunOutcome, kind: 'computation' | 'simulation' = 'computation'): Classification {
  if (outcome.status === 'unavailable') {
    return {
      stepStatus: 'blocked',
      executionLabel: 'blocked',
      blockKind: 'tool_missing',
      summary: `Code could not be run: ${outcome.detail || 'the code sandbox is not available'}.`,
    };
  }
  if (outcome.timedOut || outcome.status === 'timeout') {
    return {
      stepStatus: 'failed',
      executionLabel: 'code_written',
      blockKind: null,
      summary: 'The code was written but did not finish within the time limit, so nothing was executed to completion.',
    };
  }
  const mod = missingModule(outcome.stderr);
  if (outcome.exitCode !== 0 && mod) {
    return {
      stepStatus: 'blocked',
      executionLabel: 'blocked',
      blockKind: 'tool_missing',
      summary: `The code needs the Python module "${mod}", which the sandbox does not have.`,
    };
  }
  const file = MISSING_FILE.exec(outcome.stderr)?.[1];
  if (outcome.exitCode !== 0 && file && !file.startsWith('/out')) {
    return {
      stepStatus: 'blocked',
      executionLabel: 'blocked',
      blockKind: 'data_missing',
      summary: `The code needs the input file "${file}", which has not been provided.`,
    };
  }
  const label: ExecutionLabel = kind === 'simulation' ? 'simulation_run' : 'code_executed';
  return outcome.exitCode === 0
    ? { stepStatus: 'succeeded', executionLabel: label, blockKind: null, summary: `Ran in ${(outcome.durationMs / 1000).toFixed(1)}s, exit code 0.` }
    : {
        stepStatus: 'succeeded',
        executionLabel: label,
        blockKind: null,
        summary: `Ran, and exited with code ${outcome.exitCode}. The interpretation explains the error.`,
      };
}

/** Keep the tail: the end of stdout/stderr is where results and tracebacks are. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `[… ${text.length - max} characters truncated …]\n` + text.slice(-max), truncated: true };
}
