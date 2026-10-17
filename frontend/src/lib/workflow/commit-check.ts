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
 * The decided rows of `before` that `after` does not carry. A row is carried
 * when its id survives, or when a row with the same decision (status and
 * reason) by the same decider sits under a new id — `carryUserFields` moves a
 * decision onto a renumbered row that way. Each carrying row counts once.
 *
 * One rule for both the refusal and the repair's restore: they had two, so a
 * repair put back what it thought was missing and the save was still refused
 * for dropping rows (15 Oct, HARBOR: "The revision dropped 4 rows you had
 * decided", four times, each counted as a failed repair).
 */
function uncarried(before: readonly StageItem[], after: readonly StageItem[]): StageItem[] {
  const ids = new Set(after.map((r) => r.id));
  const key = (r: StageItem) => `${userDecided(r) ? 'user' : 'go'}\u0000${r.status}\u0000${r.reason ?? ''}`;
  const carried = after.filter((r) => r.status && !before.some((b) => b.id === r.id)).map(key);
  const out: StageItem[] = [];
  for (const row of before.filter((r) => r.status)) {
    if (ids.has(row.id)) continue;
    const at = carried.indexOf(key(row));
    if (at >= 0) carried.splice(at, 1);
    else out.push(row);
  }
  return out;
}

/** The user's decisions a revision would drop. */
export function droppedDecisions(before: readonly StageItem[], after: readonly StageItem[]): StageItem[] {
  return uncarried(before, after).filter(userDecided);
}

/**
 * The decided rows of `before` put back where a repair left them out (13 Oct,
 * Sean's screenplay: two Continuity repairs were refused for dropping two
 * decided rows, and the next repair dropped them again). A repair is told to
 * keep them; this makes sure it does, rather than refusing its whole result.
 * Each comes back exactly as it was, in its old place in the order. A row the
 * model echoed under a new id as its own decision is replaced by the original,
 * so the user's decision is not shown twice.
 */
export function restoreDecided(before: readonly StageItem[], after: readonly StageItem[]): StageItem[] {
  const missing = uncarried(before, after);
  if (!missing.length) return [...after];
  const out = [...after];
  for (const row of missing) {
    const echo = out.findIndex((o) => o.status === row.status && (o.reason ?? '') === (row.reason ?? '') && rowName(o) === rowName(row) && !before.some((b) => b.id === o.id));
    if (echo >= 0) {
      out[echo] = row;
      continue;
    }
    const at = before.indexOf(row);
    // After the nearest earlier row that survived, else first.
    const prev = before.slice(0, at).reverse().find((r) => out.some((o) => o.id === r.id));
    const pos = prev ? out.findIndex((o) => o.id === prev.id) + 1 : 0;
    out.splice(pos, 0, row);
  }
  return out;
}

/** Who decided a row, as the refusal says it (13 Oct: "you" was said of rows Go decided). */
export function decidedBy(rows: readonly StageItem[]): string {
  const byUser = rows.some((r) => r.status_source === 'user' || !r.status_source);
  const byGo = rows.some((r) => r.status_source === 'policy' || r.status_source === 'model');
  return byUser && byGo ? 'decided by you or by PromptMaster under your routine authority' : byGo ? 'PromptMaster decided under your routine authority' : 'you had decided';
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

/**
 * What saved a version, in words: the refusal says what changed the stage
 * (14 Oct, Sean, ASPEN: "the cause of that concurrent change isn't clear").
 */
export function changedBy(operation: string): string {
  if (operation === 'stage_draft') return 'the draft started when the stage opened';
  if (operation === 'stage_regenerate') return 'a regenerated draft';
  if (operation.startsWith('agent_')) return 'an earlier Go step';
  if (operation.startsWith('chat_')) return 'a change from the side chat';
  if (operation === 'stage_edit' || operation === 'user_edit') return 'your edit';
  if (operation === 'restore') return 'a restored version';
  if (operation.startsWith('applied_')) return 'applied suggestions';
  return 'another save';
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
  /** How the current version was made, to say what changed the stage. */
  beforeOperation?: string;
}): string | null {
  const { before, after, operation, base } = input;
  const byUser = USER_OPERATIONS.has(operation);

  if (base !== undefined && (base ?? '') !== (before ?? '')) {
    const by = input.beforeOperation ? changedBy(input.beforeOperation) : '';
    return `The stage changed while this revision was being made${by ? ` (${by} was saved meanwhile)` : ''}, so nothing was overwritten`;
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
        return `The revision dropped ${dropped.length === 1 ? 'a row' : `${dropped.length} rows`} ${decidedBy(dropped)} (${names}${more}), so the current version was kept`;
      }
    }
  }

  return null;
}
