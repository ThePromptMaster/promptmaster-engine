/**
 * PM-12: a step's execution label is derived from what was actually done,
 * never taken from the model. Pure.
 *
 * Sean, Sep 10: "discussed, designed, code written, code executed, simulation
 * run, result interpreted, blocked" are different claims. The mapping:
 *
 *   reasoning moves (derive, prove, …), evaluation   → discussed
 *   drafting / revising a stage artifact             → designed (written, nothing run)
 *   run_computation                                  → from the sandbox's own record
 *                                                      (lib/sandbox/outcome.ts)
 *   interpret_result                                 → result_interpreted, only with a run to cite
 *   anything that stopped on a missing tool/data     → blocked
 *   pure workflow moves (advance, ask, complete)     → no label — they are not work on the artifact
 *
 * The database re-checks the two that could be lied about (code_executed /
 * simulation_run need a sandbox run for the step; result_interpreted must cite
 * one), so a bug here fails loudly instead of recording a false claim.
 */

import type { AgentRun, AgentStep, ExecutionLabel } from '@/types/agent';
import { actionFor, INTERPRET_STEP } from './actions';

export function deriveExecutionLabel(
  actionKey: string,
  outcome: { blocked: boolean; sandboxLabel?: ExecutionLabel | null; interpretedRunId?: string | null }
): ExecutionLabel | null {
  if (outcome.blocked) return 'blocked';
  if (actionKey === INTERPRET_STEP) return outcome.interpretedRunId ? 'result_interpreted' : 'discussed';
  const action = actionFor(actionKey);
  switch (action?.performer) {
    case 'reason':
    case 'evaluate':
    case 'triage':
      return 'discussed';
    case 'draft':
    case 'revise':
    case 'outline':
    case 'sections':
    case 'apply':
      return 'designed';
    case 'compute':
      // Never more than the sandbox recorded; without a record, only code was written.
      return outcome.sandboxLabel ?? 'code_written';
    // A lookup reads an index; it runs no code and writes no draft.
    case 'literature':
      return 'discussed';
    default:
      return null;
  }
}

export const LABEL_TEXT: Record<ExecutionLabel, { text: string; executed: boolean }> = {
  discussed: { text: 'Analyzed', executed: false },
  designed: { text: 'Draft written', executed: false },
  code_written: { text: 'Code written — not run', executed: false },
  code_executed: { text: 'Code executed', executed: true },
  simulation_run: { text: 'Simulation run', executed: true },
  result_interpreted: { text: 'Result interpreted', executed: true },
  blocked: { text: 'Could not continue', executed: false },
};

/** A step's status in the user's words (C2): the raw status stays in the execution record. */
export const STEP_STATUS_TEXT: Record<AgentStep['status'], string> = {
  running: 'In progress',
  succeeded: 'Done',
  failed: 'Failed',
  blocked: 'Could not continue',
  awaiting_decision: 'Waiting for your approval',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

/** A run's status in the user's words (C2). */
export const RUN_STATUS_TEXT: Record<AgentRun['status'], string> = {
  running: 'Running',
  awaiting_decision: 'Waiting for you',
  blocked: 'Could not continue',
  completed: 'Completed',
  budget_exhausted: 'Window used up',
  stopped: 'Stopped',
  failed: 'Failed',
};
