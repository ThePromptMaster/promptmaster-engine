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
 *
 * Code that ran only to say it had nothing to work on did not carry out the
 * analysis. The code-writer is told to print `MISSING_DATA: <what>` in that
 * case; that line, at any exit code, is blocked on missing data — never
 * `code_executed`, which would settle the run's row as Completed.
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
  /** For `data_missing`: what was missing, as a sentence a table row can carry as its reason. */
  missing?: string;
}

const MISSING_MODULE = /ModuleNotFoundError: No module named '([^']+)'/;
const MISSING_FILE = /FileNotFoundError: \[Errno 2\] No such file or directory: '([^']+)'/;

const MISSING_DATA = /^[ \t]*MISSING_DATA:[ \t]*(.*)$/m;
/**
 * The same thing said in the code-writer's own `label: value` convention. On
 * production (2026-10-03) the model printed `status: not_run` and a reason
 * line, exited 0, and its row was marked Completed "from a sandbox run".
 */
const STATUS_NOT_RUN = /^[ \t]*(?:status|run_status|result)[ \t]*:[ \t]*["']?(?:not[_ ]run|not[_ ]executed|missing[_ ]data|blocked)["']?[ \t]*$/im;
const WHY_LINE = /^[ \t]*(?:reason|missing|missing_data|why|why_not_run|observed|note|notes?)[ \t]*:[ \t]*(.+)$/im;

/** What the code itself said it could not run without, or null. */
export function missingData(stdout: string, stderr = ''): string | null {
  const said = MISSING_DATA.exec(stdout) ?? MISSING_DATA.exec(stderr);
  if (said) return said[1].trim().replace(/\s+/g, ' ').slice(0, 300) || 'the data this run needs has not been provided';
  if (STATUS_NOT_RUN.test(stdout)) {
    const why = WHY_LINE.exec(stdout)?.[1]?.trim().replace(/\s+/g, ' ');
    return (why || 'the code reported that this run could not be made from the data provided').slice(0, 300);
  }
  return null;
}

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
  const data = missingData(outcome.stdout, outcome.stderr);
  if (data) {
    return {
      stepStatus: 'blocked',
      executionLabel: 'blocked',
      blockKind: 'data_missing',
      summary: `The analysis was not carried out. The code reported what it was missing: ${data}`,
      missing: data,
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
      missing: `The input file "${file}" has not been provided.`,
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
