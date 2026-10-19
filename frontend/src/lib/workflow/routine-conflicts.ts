/**
 * L-93 (Sean, 17 Oct, email 2): "When a request clearly conflicts with
 * accepted facts, can the system preserve those facts and continue without
 * asking the user to reconfirm them? A genuine change in authority or scope
 * would still need a decision."
 *
 * Pure. Whether a conflict is kept without asking is decided here, in code;
 * the model only proposes which words are someone else's request, and the
 * backend checks those words (conflicts.py `_request`). Keeping the record
 * never changes it, so the safe side is the one taken without a question;
 * anything that could change the record still asks.
 */

import { gist, nameOf, type InstructionConflict } from './instruction-conflicts';

/** Where the conflicting instruction came from. */
export type ConflictOrigin =
  /** Typed by the user, or an action button the user pressed. */
  | 'user'
  /** A revision Go chose for itself: its own proposal, which carries no authority. */
  | 'go';

export type RoutineKeep =
  | { keep: true; note: string }
  | { keep: false; why: string };

/**
 * Keep the accepted record and carry on, or ask "which takes priority?".
 *
 * Kept without asking only when routine decisions are handled and every
 * conflict is a request set against the record: Go's own proposal, or words
 * that report someone else's request (`from_request`). Still asked:
 * - routine decisions are set to "Ask me";
 * - the instruction records an approval (`instruction_authorised`): a later
 *   authorised word may change the record;
 * - the user's own instruction conflicts, or two instructions conflict;
 * - the request comes from someone the record lets approve (the backend
 *   leaves `from_request` unset): a change of authority or scope to decide.
 */
export function keepWithoutAsking(
  conflicts: readonly InstructionConflict[],
  opts: { routineHandled: boolean; origin: ConflictOrigin }
): RoutineKeep {
  if (!conflicts.length) return { keep: false, why: 'Nothing conflicts.' };
  if (!opts.routineHandled) return { keep: false, why: 'Routine decisions are set to "Ask me".' };
  if (conflicts.some((c) => c.instruction_authorised)) return { keep: false, why: 'The instruction records an approval.' };
  if (opts.origin === 'user' && !conflicts.every((c) => c.from_request && c.kind !== 'instruction')) {
    return { keep: false, why: 'Your own instruction conflicts with the record.' };
  }
  return { keep: true, note: keptNote(conflicts, opts.origin) };
}

/** "Kept the recorded fact (…): the COO's request (…) has no approval." One line per conflict. */
export function keptNote(conflicts: readonly InstructionConflict[], origin: ConflictOrigin): string {
  return conflicts
    .map((c) => {
      const what = `Kept ${keptName(c)} (${gist(c.with_text, 120)})`;
      const against =
        origin === 'go'
          ? 'Go’s own proposal does not override it'
          : `${requestOf(c)} is a request nobody with authority has approved`;
      return `${what}: ${against}.`;
    })
    .join(' ');
}

/**
 * What was kept, as the note names it. A record that protects an approval
 * often says nothing is approved yet ("The board has not approved it"), so
 * "the recorded approval" read as the opposite of the record (19 Oct, prod).
 */
function keptName(c: InstructionConflict): string {
  return c.protects_approval ? 'the approval status on record' : nameOf(c);
}

function requestOf(c: InstructionConflict): string {
  const quote = gist(c.request_quote ?? '', 120);
  return quote ? `“${quote}”` : 'the request';
}

/**
 * What the model is told with the instruction, in place of the user's answer:
 * keep the record, and record what was asked as an unapproved request. Says
 * it was the routine-decision policy, not the user, that chose.
 */
export function routinePrecedenceNote(c: InstructionConflict): string {
  return (
    `Under the user's routine-decision policy, keep ${nameOf(c)} (${gist(c.with_text, 200)}). ` +
    (c.resolution?.trim() || 'Record what the instruction asks for as a request that has not been approved, and change nothing that depends on the record.')
  );
}

/** What a step that kept the record without asking holds, for "Apply it anyway". */
export interface KeptConflicts {
  instruction: string;
  conflicts: InstructionConflict[];
  note: string;
}

/** Read back from a Go step's params; null when the step kept nothing. */
export function keptConflictsOf(params: Record<string, unknown> | null | undefined): KeptConflicts | null {
  const kept = params?.routine_conflict_kept as Partial<KeptConflicts> | undefined;
  if (!kept || typeof kept.instruction !== 'string' || !Array.isArray(kept.conflicts) || !kept.conflicts.length) return null;
  return { instruction: kept.instruction, conflicts: kept.conflicts, note: typeof kept.note === 'string' ? kept.note : '' };
}
