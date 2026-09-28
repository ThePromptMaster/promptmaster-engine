/**
 * "Succeeded" means the intended state change happened (SN-25). Pure.
 *
 * Sean's screenshot 3: a "Revise this stage" step showed Written / succeeded
 * while the stage's required artifact was still missing. A step that changes
 * the project is only a success if the record shows what it changed; a
 * performer that reports success with nothing in `changes` is recorded as
 * failed, with the original output kept so the reader sees both.
 */

import type { StepOutcome } from './perform';
import { actionFor } from './actions';

/** Performers whose success is a change to the project, not a piece of text. */
const MUTATING = new Set(['draft', 'revise', 'outline', 'sections', 'apply', 'triage']);

export function changedSomething(changes: StepOutcome['changes'] | undefined): boolean {
  if (!changes) return false;
  return Boolean(
    changes.version_ids?.length || changes.sections_written?.length || changes.items_triaged?.length || changes.event_types?.length || changes.sandbox_run_id
  );
}

export function assertHonestOutcome(actionKey: string, outcome: StepOutcome): StepOutcome {
  const performer = actionFor(actionKey)?.performer;
  if (!performer || !MUTATING.has(performer)) return outcome;
  if (outcome.status !== 'succeeded' || changedSomething(outcome.changes)) return outcome;
  return {
    ...outcome,
    status: 'failed',
    output: `${outcome.output}\n\nRecorded as failed: this step reported success, but no change to the project was found.`,
  };
}
