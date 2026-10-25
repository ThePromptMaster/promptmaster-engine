/**
 * The visible IDs a generated revision would bring back or rename (12 Oct;
 * Sean, Meridian).
 *
 * The user removed the Supplier initiative and its rows; Go's review proposed
 * restoring them. In the same test proposal D3 became "D3-P", and R-002 was
 * reused for a different risk. A register's IDs are its history: an item the
 * user removed stays removed, and an ID keeps its form. Matched in code — a
 * revision that would restore or rename one is not saved, and the user is
 * asked. Pure.
 */

import type { ArtifactVersion } from '@/types/project';
import { USER_CHOSEN_OPERATIONS } from './fact-reconcile';

/**
 * R-002, D3, Q11, S7, A-12, a suffixed form such as D3-P, and a prefixed one
 * such as KES-T3 — whole: "T3" inside "KES-T3" is not an ID of its own (18 Oct,
 * pilot: a project's KES-T3 was read as a "T3" and every repair was refused).
 */
const ID = /(?<![A-Za-z0-9-])((?:[A-Z]{2,5}-)?[A-Z]{1,3})-?(\d{1,3})(?:-([A-Z]{1,2}))?\b(?![-.]?\d)/g;

/** The IDs a text names, as written. */
export function itemIds(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(ID), (m) => m[0]));
}

/** "D3-P" → "D3"; "R-002" → "R2": what an ID is, whatever its decoration. */
function base(id: string): string {
  const m = /^((?:[A-Z]{2,5}-)?[A-Z]{1,3})-?(\d{1,3})/.exec(id);
  return m ? `${m[1]}${Number(m[2])}` : id;
}

/** Ways of making a version that are the user's own choice. */
const USER_MADE: ReadonlySet<string> = new Set([...USER_CHOSEN_OPERATIONS, 'chat_save']);

/**
 * The IDs the user's own versions took out of the text, and that the latest
 * version still leaves out.
 */
export function removedByUser(versions: readonly Pick<ArtifactVersion, 'content' | 'source_operation'>[]): Set<string> {
  const out = new Set<string>();
  versions.forEach((v, i) => {
    if (i === 0 || !USER_MADE.has(v.source_operation)) return;
    const now = itemIds(v.content ?? '');
    for (const id of itemIds(versions[i - 1].content ?? '')) if (!now.has(id)) out.add(id);
  });
  const head = itemIds(versions.at(-1)?.content ?? '');
  for (const id of [...out]) if (head.has(id)) out.delete(id);
  return out;
}

export interface IdChanges {
  /** IDs the user removed that the revision puts back. */
  restored: string[];
  /** IDs of the current text that the revision writes in another form: [was, now]. */
  renamed: [string, string][];
  /** IDs kept, but given to a different item (13 Oct; Sean: the vacancy issue overwritten by an onboarding issue). */
  reused?: string[];
}

/** Words that say little about what an item is about. */
const STOP = new Set(['about', 'after', 'again', 'also', 'been', 'before', 'being', 'from', 'have', 'into', 'more', 'must', 'need', 'needs', 'once', 'only', 'open', 'closed', 'resolved', 'complete', 'completed', 'done', 'status', 'still', 'than', 'that', 'their', 'there', 'these', 'this', 'those', 'through', 'under', 'until', 'were', 'what', 'when', 'which', 'will', 'with', 'within', 'without', 'would', 'owner', 'target', 'pending', 'progress']);

/**
 * The meaningful words of the line the ID labels — a table row or list entry
 * that starts with it: what that item is about. A sentence that merely
 * mentions the ID says nothing about which item it is (18 Oct, pilot: prose
 * naming KES-T3 in a different sentence was read as a reused ID).
 */
function subjectOf(text: string, id: string): Set<string> {
  const line = text.split('\n').find((l) => labels(l, id)) ?? '';
  return new Set(
    line.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w))
  );
}

/** Whether the line is the item the ID labels: it starts with the ID, after a table bar, bullet or number. */
function labels(line: string, id: string): boolean {
  const start = line.replace(/^[\s|*>#\-+]*(?:\d+[.)]\s*)?(?:\*\*)?/, '');
  return start.startsWith(id) && itemIds(start.slice(0, id.length + 1)).has(id);
}

/**
 * An ID kept but now about something else: the words on its line barely
 * overlap with what they were. A status change or a reworded description
 * keeps most of them; a different issue does not.
 */
function reusedIds(head: string, generated: string, both: readonly string[]): string[] {
  return both.filter((id) => {
    const was = subjectOf(head, id);
    const now = subjectOf(generated, id);
    if (was.size < 4 || now.size < 4) return false;
    const shared = [...was].filter((w) => now.has(w)).length;
    return shared / Math.min(was.size, now.size) < 0.2;
  });
}

export function idChanges(input: { head: string; generated: string; removed: ReadonlySet<string> }): IdChanges {
  const head = itemIds(input.head);
  const next = itemIds(input.generated);
  const restored = [...input.removed].filter((id) => next.has(id));
  const renamed: [string, string][] = [];
  for (const id of head) {
    if (next.has(id)) continue;
    const other = [...next].find((n) => !head.has(n) && base(n) === base(id));
    if (other) renamed.push([id, other]);
  }
  const reused = reusedIds(input.head, input.generated, [...head].filter((id) => next.has(id)));
  return { restored, renamed, reused };
}

export function hasIdChanges(c: IdChanges): boolean {
  return c.restored.length > 0 || c.renamed.length > 0 || (c.reused?.length ?? 0) > 0;
}

/**
 * The answer "Handle them for me" gives the ID question itself (25 Oct, Sean's
 * iPad: the run stopped on it, and "Do whatever is best" was typed by hand).
 * It is the record-keeping rule the question states, so it is routine.
 */
export function idChangeDefault(version: number): string {
  return (
    `Keep every item ID as v${version} has it: an ID keeps the item it named (closed if it is closed), ` +
    'a new item gets a new ID, and an item I removed stays removed.'
  );
}

/** The question Go asks instead of saving such a revision. */
export function idChangeQuestion(stageLabel: string, version: number, c: IdChanges): string {
  const parts = [
    c.restored.length ? `bring back ${c.restored.join(', ')}, which your earlier change removed` : '',
    c.renamed.length ? `rename ${c.renamed.map(([a, b]) => `${a} to ${b}`).join(', ')}` : '',
    c.reused?.length ? `give ${c.reused.join(', ')} to a different item (a new item should get a new ID, and the old one stay in the record, closed if it is closed)` : '',
  ].filter(Boolean);
  return (
    `The revision of ${stageLabel} would ${parts.join(' and ')}. I have not saved it; v${version} stays current. ` +
    'Should those items come back, or stay as your version has them? Answer, and I will revise accordingly.'
  );
}
