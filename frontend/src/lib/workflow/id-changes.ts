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

/** R-002, D3, Q11, S7, A-12, and a suffixed form such as D3-P. */
const ID = /\b([A-Z]{1,3})-?(\d{1,3})(?:-([A-Z]{1,2}))?\b(?![-.]?\d)/g;

/** The IDs a text names, as written. */
export function itemIds(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(ID), (m) => m[0]));
}

/** "D3-P" → "D3"; "R-002" → "R2": what an ID is, whatever its decoration. */
function base(id: string): string {
  const m = /^([A-Z]{1,3})-?(\d{1,3})/.exec(id);
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
  return { restored, renamed };
}

export function hasIdChanges(c: IdChanges): boolean {
  return c.restored.length > 0 || c.renamed.length > 0;
}

/** The question Go asks instead of saving such a revision. */
export function idChangeQuestion(stageLabel: string, version: number, c: IdChanges): string {
  const parts = [
    c.restored.length ? `bring back ${c.restored.join(', ')}, which your earlier change removed` : '',
    c.renamed.length ? `rename ${c.renamed.map(([a, b]) => `${a} to ${b}`).join(', ')}` : '',
  ].filter(Boolean);
  return (
    `The revision of ${stageLabel} would ${parts.join(' and ')}. I have not saved it; v${version} stays current. ` +
    'Should those items come back, or stay as your version has them? Answer, and I will revise accordingly.'
  );
}
