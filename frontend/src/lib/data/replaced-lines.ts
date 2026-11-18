/**
 * What a replaced document changed, line by line, and the facts that were its
 * old words (18 Nov, hand pass). Pure.
 *
 * Replacing a document swapped its words in the project context, but a fact the
 * start conversation had copied from it ("Customer-reported incidents: unchanged
 * (median 0 change).") stayed as the user's own, so every prompt carried the old
 * figure beside the new one. Each changed line is paired with its new line by the
 * label before its colon, or, when the rest changed one for one, by order; a
 * current fact that is exactly an old line is changed to the new one.
 */
import type { ProjectFact } from '@/types/project';

export interface ChangedLine {
  before: string;
  after: string;
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
const label = (line: string) => {
  const at = line.indexOf(':');
  return at > 0 && at <= 80 ? norm(line.slice(0, at)) : null;
};

/** Each line of the old text that changed, with the line that took its place. */
export function changedLines(before: string, after: string): ChangedLine[] {
  const was = lines(before);
  const now = lines(after);
  const kept = new Set(now.map(norm));
  const had = new Set(was.map(norm));
  const removed = was.filter((l) => !kept.has(norm(l)));
  const added = now.filter((l) => !had.has(norm(l)));
  const out: ChangedLine[] = [];
  const left: string[] = [];
  const free = [...added];
  for (const old of removed) {
    const key = label(old);
    const at = key ? free.findIndex((l) => label(l) === key) : -1;
    if (at >= 0) out.push({ before: old, after: free.splice(at, 1)[0] });
    else left.push(old);
  }
  if (left.length && left.length === free.length) left.forEach((old, i) => out.push({ before: old, after: free[i] }));
  return out;
}

/** The current facts that are exactly an old line, each with what it becomes. */
export function factsFromReplacedLines(
  facts: readonly Pick<ProjectFact, 'id' | 'statement' | 'retired_at'>[],
  changed: readonly ChangedLine[]
): { fact: Pick<ProjectFact, 'id' | 'statement' | 'retired_at'>; statement: string }[] {
  if (!changed.length) return [];
  return facts.flatMap((fact) => {
    if (fact.retired_at) return [];
    const line = changed.find((c) => norm(c.before) === norm(fact.statement));
    return line ? [{ fact, statement: line.after }] : [];
  });
}
