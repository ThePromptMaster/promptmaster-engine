import { diffLines } from 'diff';

/**
 * What one saved version changed against the one before it, as lines, worked
 * out in code (19 Oct, Research › Method: Go asked the user to approve a
 * version and then said "I cannot see what the one applied finding changed").
 * The step that saved it, the planner and the question card all read this,
 * so none of them has to piece the change together from a summary. Pure.
 */
export interface VersionChange {
  removed: string[];
  added: string[];
  /** Changed lines left out to keep the description short. */
  more: number;
}

const LINE_MAX = 240;

const clip = (line: string) => (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line);

export function versionChange(before: string, after: string, max = 8): VersionChange {
  const removed: string[] = [];
  const added: string[] = [];
  for (const part of diffLines(before, after)) {
    if (!part.added && !part.removed) continue;
    const lines = part.value.split('\n').map((l) => l.trim()).filter(Boolean);
    (part.added ? added : removed).push(...lines);
  }
  // Moved lines are not changes.
  const kept = new Set(removed.filter((l) => added.includes(l)));
  const r = removed.filter((l) => !kept.has(l));
  const a = added.filter((l) => !kept.has(l));
  const total = r.length + a.length;
  const takeRemoved = Math.min(r.length, Math.ceil(max / 2), max - Math.min(a.length, Math.floor(max / 2)));
  const takeAdded = Math.min(a.length, max - takeRemoved);
  return { removed: r.slice(0, takeRemoved).map(clip), added: a.slice(0, takeAdded).map(clip), more: total - takeRemoved - takeAdded };
}

/** The change as plain lines: "− old" / "+ new", or that nothing changed. */
export function describeVersionChange(change: VersionChange): string {
  if (!change.removed.length && !change.added.length) return 'The text did not change.';
  return [
    ...change.removed.map((l) => `− ${l}`),
    ...change.added.map((l) => `+ ${l}`),
    ...(change.more > 0 ? [`(and ${change.more} more changed line${change.more === 1 ? '' : 's'})`] : []),
  ].join('\n');
}
