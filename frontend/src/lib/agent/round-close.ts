/**
 * When Go stops starting rounds of ongoing work and moves on to the write-up.
 * Pure.
 *
 * 19 Oct, production (HARBOR acquisition screening): under "Handle them for
 * me", Go ran nine full rounds — Sources, Analysis, Red flags, Check, Update
 * round, then back to Sources — and never reached the Screening package. No
 * new material arrived between rounds: each one only applied the previous
 * Check's findings, and each Check found more. The objective check at the end
 * of a round could never say "met", because the package that meets it is
 * written by the stage after the round.
 *
 * The rule: a round Go starts on its own must have something new to work on.
 * Once Go has started `MAX_AUTO_ROUNDS` rounds since the last outside input —
 * a data file, a fact the user stated, a round the user started — it moves on
 * to the stage that follows the round instead of starting another. What is
 * still open goes forward with the work; the write-up's approval is still the
 * user's.
 */

import type { ProjectFact, ProjectFile } from '@/types/project';
import type { StageDefinition, WorkflowEvent } from '@/lib/workflow/types';

export const MAX_AUTO_ROUNDS = 2;

/** Facts that came from outside the work: Go's own stages do not count as new material. */
const OUTSIDE_FACT: ReadonlySet<ProjectFact['source_kind']> = new Set(['brief', 'file', 'chat', 'user_edit']);

export interface RoundClose {
  /** The stage to move on to. */
  to: string;
  /** Rounds Go started since the last outside input. */
  rounds: number;
  reason: string;
}

/** The latest time something new reached the project from outside its own stages. */
export function lastOutsideInput(args: {
  events: readonly Pick<WorkflowEvent, 'type' | 'actor' | 'created_at'>[];
  files?: readonly Pick<ProjectFile, 'created_at'>[];
  facts?: readonly Pick<ProjectFact, 'source_kind' | 'created_at'>[];
}): string {
  const times = [
    ...(args.files ?? []).map((f) => f.created_at),
    ...(args.facts ?? []).filter((f) => OUTSIDE_FACT.has(f.source_kind)).map((f) => f.created_at),
    // A round the user started is their direction for it.
    ...args.events.filter((e) => e.type === 'stage_returned' && e.actor === 'user').map((e) => e.created_at),
  ];
  return times.reduce((a, b) => (a > b ? a : b), '');
}

/**
 * Whether Go should move on from the stage that closes a round instead of
 * starting another one, and where to. Null: start the round as before.
 */
export function roundClose(args: {
  stage: Pick<StageDefinition, 'id' | 'transitions'>;
  /** Labels for the reason. */
  label: (stageId: string) => string;
  events: readonly Pick<WorkflowEvent, 'type' | 'stage_id' | 'actor' | 'payload' | 'created_at'>[];
  files?: readonly Pick<ProjectFile, 'created_at'>[];
  facts?: readonly Pick<ProjectFact, 'source_kind' | 'created_at'>[];
}): RoundClose | null {
  const to = args.stage.transitions.default_next;
  if (!args.stage.transitions.loop_to || !to) return null;
  const since = lastOutsideInput(args);
  const rounds = args.events.filter(
    (e) => e.type === 'stage_returned' && e.stage_id === args.stage.id && e.actor === 'system'
      && e.payload?.next_round === true && e.created_at > since
  ).length;
  if (rounds < MAX_AUTO_ROUNDS) return null;
  return {
    to,
    rounds,
    reason: `Go has run ${rounds} rounds since anything new reached the project, so it is not starting another: moving on to ${args.label(to)}. What is still open goes forward as open items and limitations.`,
  };
}
