/**
 * A review row the user's own answer has settled (12 Nov). Pure.
 *
 * On a training plan the check asked "confirm absences or leave". The user set
 * the row to Deferred and wrote the answer as the reason: "There are no
 * additional absences to account for". The stage's approval read the note, but
 * a deferred major row always counted as "carried forward, still unmet", so Go
 * stopped on it at the finish, and stopped on it again after the note was
 * reworded: nothing read the note, and nothing ever closed a deferred row.
 *
 * The row keeps the status the user chose. It gains the words that settle it
 * (`settled_by`), where they came from (`settled_source`) and, for a fact, its
 * id (`settled_ref`), as `superseded_by` marks a row a later fact replaced. A
 * settled row is not open work. Only the user's own words settle one: the note
 * they wrote on the row, a fact they stated or decided, or their press of "It
 * is settled".
 */
import { parseItems, type StageItem } from './stage-artifact';

export const SETTLED_KEYS = ['settled_by', 'settled_source', 'settled_ref'] as const;

/** `note`: the row's own reason. `fact`: a fact the user stated or decided. `user`: they said so on the stop. */
export type SettledSource = 'note' | 'fact' | 'user';

/** The user looked at a row said to be settled and kept it open: it is not judged again. */
const KEPT_OPEN = 'kept_open';

export const isSettled = (row: StageItem): boolean => Boolean(row.settled_by?.trim());

/** Kept open by the user after it was said to be settled: theirs to close, not a check's. */
export const keptOpen = (row: StageItem): boolean => row.settled_source === KEPT_OPEN && !isSettled(row);

/** A carried row as a stop shows it and a check reads it. */
export interface CarriedRow {
  id: string;
  /** What the row says is wrong, with its suggested change. */
  text: string;
  /** The reason recorded with its status: often the user's answer. */
  note: string;
  severity?: string;
  /** Who set the status: only a note the user wrote can settle the row by itself. */
  source?: string;
  /** The user was told it looked settled and kept it open: no check judges it again. */
  keptOpen?: boolean;
}

/** The row with what settled it. The status and its reason stay as they are. */
export function markSettled(
  items: readonly StageItem[],
  id: string,
  by: { quote: string; source: SettledSource; ref?: string | null }
): StageItem[] {
  const quote = by.quote.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!quote) return [...items];
  return items.map((row) => {
    if (row.id !== id) return row;
    const next: StageItem = { ...row, settled_by: quote, settled_source: by.source };
    if (by.ref) next.settled_ref = by.ref;
    else delete next.settled_ref;
    return next;
  });
}

/** "Keep it open instead": the row is open work again, and no check settles it a second time. */
export function unsettle(items: readonly StageItem[], id: string): StageItem[] {
  return items.map((row) => {
    if (row.id !== id) return row;
    const next: StageItem = { ...row, settled_source: KEPT_OPEN };
    delete next.settled_by;
    delete next.settled_ref;
    return next;
  });
}

/**
 * A version that only says which rows are settled, or opens one again, changes
 * nothing a later stage read: the finding, its status and its reason are as
 * they were. Saving it must not reopen the stages after it (the reworded note
 * on the training plan reopened two, and Go repaired both before stopping on
 * the same row). What the answer changes downstream is the fact's to reopen.
 */
export function onlySettles(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = parseItems(before);
  const b = parseItems(after);
  if (!a || !b || a.length !== b.length || a.length === 0) return false;
  const bare = (row: StageItem) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !(SETTLED_KEYS as readonly string[]).includes(k))));
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (bare(a[i]) !== bare(b[i])) return false;
    if (SETTLED_KEYS.some((k) => (a[i][k] ?? '') !== (b[i][k] ?? ''))) changed += 1;
  }
  return changed > 0;
}
