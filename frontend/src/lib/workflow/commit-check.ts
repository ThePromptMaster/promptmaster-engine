import { parseItems, type StageItem } from './stage-artifact';

/**
 * The one check every new stage version passes before it becomes current.
 *
 * A model's revision is a proposal: it becomes the stage's current work only if
 * it still holds the work. On 4 Oct a revision of a populated Options table
 * came back as prose, was saved as v3, and the stage showed "No claims yet"
 * with its criteria falling from 1/2 to 0/2. The guard that would have caught
 * it lived in one of the two apply paths only; here it sits in front of every
 * append, so a new path cannot ship without it.
 *
 * Pure: it sees the current head and the proposed content, nothing else.
 *
 * It judges shape, not length. A rule refusing rewrites that kept under 30%
 * of the text was removed after its first production run (6 Oct): the check
 * had asked for a 23,000-character overshoot to be cut to a positioning
 * statement, and the cut was exactly what was wanted.
 */

/** Operations the user performs by hand. They may empty a table on purpose. */
const USER_OPERATIONS = new Set(['stage_edit', 'outline_edit', 'restore']);

/**
 * Revisions the user saw before they were saved: their own edits, and a chat
 * proposal they accepted. Only these may drop a row the user decided (6 Oct):
 * everything else — Go's moves, findings applied to a table, a refine — is
 * saved without the user reading it, and a decision lost there is lost
 * silently.
 */
const REVIEWED_OPERATIONS = new Set([...USER_OPERATIONS, 'chat_instruct', 'chat_save', 'chat_rows']);

/** A row whose status the user set (no source is the user, from before sources were recorded). */
function userDecided(row: StageItem): boolean {
  return Boolean(row.status) && (row.status_source === 'user' || !row.status_source);
}

/**
 * The user's decisions a revision would drop. A row counts as kept when its id
 * survives, or when a row carries the same decision under a new id —
 * `carryUserFields` moves a decision onto a renumbered row that way.
 */
export function droppedDecisions(before: readonly StageItem[], after: readonly StageItem[]): StageItem[] {
  const ids = new Set(after.map((r) => r.id));
  const carried = after.filter(userDecided).map((r) => `${r.status}\u0000${r.reason ?? ''}`);
  const dropped: StageItem[] = [];
  for (const row of before.filter(userDecided)) {
    if (ids.has(row.id)) continue;
    const at = carried.indexOf(`${row.status}\u0000${row.reason ?? ''}`);
    if (at >= 0) carried.splice(at, 1);
    else dropped.push(row);
  }
  return dropped;
}

/** A row as a person names it: its first non-empty field that isn't bookkeeping. */
function rowName(row: StageItem): string {
  const skip = new Set(['id', 'status', 'reason', 'status_source']);
  const text = Object.entries(row).find(([k, v]) => !skip.has(k) && typeof v === 'string' && v.trim())?.[1] ?? row.id;
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}


export class RefusedRevision extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedRevision';
  }
}

/** The rows of a stage table — never an outline, which also carries `items`. */
function tableRows(content: string | null | undefined) {
  try {
    if ((JSON.parse((content ?? '').trim()) as { kind?: unknown })?.kind !== 'stage_items') return null;
  } catch {
    return null;
  }
  return parseItems(content);
}

export function checkCommit(input: {
  before: string | null | undefined;
  after: string;
  operation: string;
  /**
   * The content the revision was made from. When the stage has moved on since
   * (a held revision kept after another save, a Go step planned on an older
   * version), saving it would overwrite that change, so it is refused.
   */
  base?: string | null;
}): string | null {
  const { before, after, operation, base } = input;
  const byUser = USER_OPERATIONS.has(operation);

  if (base !== undefined && (base ?? '') !== (before ?? '')) {
    return 'The stage changed while this revision was being made, so nothing was overwritten';
  }

  if (!after.trim()) {
    return byUser ? null : 'The revision came back empty, so the current version was kept';
  }

  const beforeItems = tableRows(before);
  if (beforeItems && !byUser) {
    const afterItems = parseItems(after);
    if (afterItems === null) {
      return 'The revision came back as text instead of a table, so the current version was kept';
    }
    if (afterItems.length === 0 && beforeItems.length > 0) {
      return 'The revised table came back with no rows, so the current version was kept';
    }
    if (!REVIEWED_OPERATIONS.has(operation)) {
      const dropped = droppedDecisions(beforeItems, afterItems);
      if (dropped.length) {
        const names = dropped.slice(0, 3).map((r) => `"${rowName(r)}"`).join(', ');
        const more = dropped.length > 3 ? ` and ${dropped.length - 3} more` : '';
        return `The revision dropped ${dropped.length === 1 ? 'a row you had decided' : `${dropped.length} rows you had decided`} (${names}${more}), so the current version was kept`;
      }
    }
  }

  return null;
}
