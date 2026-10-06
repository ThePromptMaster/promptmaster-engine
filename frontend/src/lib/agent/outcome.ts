/**
 * "Succeeded" means the intended state change happened (SN-25). Pure.
 *
 * Sean's screenshot 3: a "Revise this stage" step showed Written / succeeded
 * while the stage's required artifact was still missing. A step that changes
 * the project is only a success if the record shows what it changed; a
 * performer that reports success with nothing in `changes` is recorded as
 * failed, with the original output kept so the reader sees both.
 *
 * That first check trusts what the performer reports. `verifyOutcome` does
 * not: it is given what the project holds after the step (facts.ts
 * `readOutcomeProof`) and fails the step when the change it names is not
 * there (1 Oct, item 4: "a model/action call completed successfully" is not
 * "the intended project-state change actually occurred").
 */

import { isDone, type StageStatus } from '@/lib/workflow/types';
import type { StepOutcome } from './perform';
import { actionFor } from './actions';

/** Performers whose success is a change to the project, not a piece of text. */
const MUTATING = new Set(['draft', 'revise', 'continue', 'outline', 'sections', 'apply', 'triage', 'commit']);

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

/** What the project holds after a step, read back from the database. */
export interface OutcomeProof {
  versions?: { id: string; found: boolean; empty: boolean }[];
  /** An evaluation row exists for the version the step says it checked. */
  evaluated?: boolean;
  /** Ids of the manuscript sections that hold text. */
  sectionsWithContent?: string[];
  stage?: { currentStageId: string; status: StageStatus | undefined; expectedStageId: string | null };
}

/** Performers whose success names a saved version. */
const SAVES_VERSION = new Set(['draft', 'revise', 'continue', 'outline', 'apply', 'triage']);

function missing(outcome: StepOutcome, what: string): StepOutcome {
  return {
    ...outcome,
    status: 'failed',
    output: `${outcome.output}\n\nRecorded as failed: ${what}`,
  };
}

export function verifyOutcome(actionKey: string, outcome: StepOutcome, proof: OutcomeProof): StepOutcome {
  if (outcome.status !== 'succeeded') return outcome;
  const performer = actionFor(actionKey)?.performer;
  if (!performer) return outcome;

  if (SAVES_VERSION.has(performer)) {
    const versions = proof.versions ?? [];
    if (!versions.length || versions.some((v) => !v.found)) return missing(outcome, 'the version this step says it saved was not found in the project.');
    if (versions.some((v) => v.empty)) return missing(outcome, 'the version this step saved is empty.');
  }
  if (performer === 'evaluate' && !proof.evaluated) {
    return missing(outcome, 'no check was found in the project for this draft.');
  }
  if (performer === 'sections') {
    const have = new Set(proof.sectionsWithContent ?? []);
    const absent = (outcome.changes.sections_written ?? []).filter((id) => !have.has(id));
    if (absent.length) {
      return missing(outcome, `${absent.length} section${absent.length === 1 ? '' : 's'} this step says it wrote ${absent.length === 1 ? 'holds' : 'hold'} no text in the project.`);
    }
  }
  if (performer === 'advance') {
    const s = proof.stage;
    if (!s) return missing(outcome, 'the project could not be read back after the move.');
    if (s.expectedStageId && s.currentStageId !== s.expectedStageId) return missing(outcome, 'the project is not on the next stage.');
    if (outcome.changes.event_types?.includes('stage_marked_complete') && !isDone(s.status)) {
      return missing(outcome, 'the stage is not recorded as complete.');
    }
  }
  return outcome;
}
