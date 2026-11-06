/**
 * How many times "Have Go fix it" has run since the user last changed anything
 * (5 Nov, a six-chapter book test). Pure.
 *
 * On production the button was pressed five times. Each press reopened the
 * Manuscript, rewrote its eight sections and rechecked the stages after it, about
 * $1.60 a time, and each check found something more in the same review note. The
 * repair caps count within a run or a reopening, and each press starts both again.
 * After two tries the check's card stops offering another: what is left needs a
 * person's word, and a typed answer, an edit or a new fact starts the count again.
 */
import { USER_CHOSEN_OPERATIONS } from '@/lib/workflow/fact-reconcile';

/** The reason recorded when "Have Go fix it" reopens what the check judged. */
export const FIX_OBJECTIVE_REASON = 'Fix what the objective check found unmet';
/** The reason recorded when the user answers the check in their own words. */
export const ANSWER_OBJECTIVE_REASON = 'Your answer to the objective check';
export const MAX_OBJECTIVE_FIXES = 2;

const at = (iso: string | undefined | null) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
};

export function objectiveFixes(input: {
  events: readonly { type: string; reason?: string | null; created_at?: string }[];
  versions: readonly { source_operation: string; created_at: string }[];
  facts: readonly { created_at: string; accepted_by?: string | null; source_ref?: Record<string, unknown> | null; retired_at?: string | null }[];
}): number {
  const lastChange = Math.max(
    0,
    ...input.versions.filter((v) => USER_CHOSEN_OPERATIONS.has(v.source_operation)).map((v) => at(v.created_at)),
    // An answer to Go is recorded as a fact as well; it is counted by its event below.
    ...input.facts.filter((f) => !f.retired_at && f.accepted_by === 'user' && f.source_ref?.via !== 'go answer').map((f) => at(f.created_at)),
    ...input.events.filter((e) => e.type === 'brief_changed' && e.reason === ANSWER_OBJECTIVE_REASON).map((e) => at(e.created_at))
  );
  return input.events.filter((e) => e.type === 'brief_changed' && e.reason === FIX_OBJECTIVE_REASON && at(e.created_at) > lastChange).length;
}

/** How a finish from the repair limit is recorded: the limitation first, then anything else said. */
export const LIMITATION_NOTE = 'Finished with this stated as a limitation: ';

/** The limitation a finish was recorded with, if any: what the finished screen says beside the work. */
export function statedLimitation(reason: string | null | undefined): string | null {
  if (!reason?.startsWith(LIMITATION_NOTE)) return null;
  return reason.slice(LIMITATION_NOTE.length).split(' — Finished with ')[0].trim() || null;
}
