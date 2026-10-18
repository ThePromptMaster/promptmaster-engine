/**
 * Which version a revision made outside PromptMaster started from (17 Oct,
 * Sean: work alongside Claude or ChatGPT — export, revise there, paste back).
 *
 * Every export carries a stamp per stage, `[PromptMaster output v5 1a2b3c4d]`.
 * A revision pasted back into "Change it" that carries an older stamp for the
 * stage was made from an older version: sent as it is, it would quietly undo
 * every change made here since. So only the user's own edits against the
 * version they started from are applied to the current one.
 *
 * Pure: the caller fetches the old version's text.
 */

export interface VersionStamp {
  stageId: string;
  version: number;
  /** The first eight characters of the version's id. */
  ref: string;
}

const STAMP = /\[PromptMaster ([a-z0-9_-]+) v(\d+) ([0-9a-f]{8})\]/gi;

/** The stamp an export prints for a stage's version. */
export function stampFor(stageId: string, version: { version_number: number; id: string }): string {
  return `[PromptMaster ${stageId} v${version.version_number} ${version.id.replace(/-/g, '').slice(0, 8).toLowerCase()}]`;
}

/** What the export says about the stamps, once, so a reader knows to keep them. */
export const STAMP_NOTE =
  'Revising this elsewhere? Keep the [PromptMaster …] stamps: when you paste the revision back into "Change it", ' +
  'PromptMaster uses them to keep the changes made here since you exported.';

export function readStamps(text: string): VersionStamp[] {
  return [...text.matchAll(STAMP)].map((m) => ({ stageId: m[1].toLowerCase(), version: Number(m[2]), ref: m[3].toLowerCase() }));
}

/** The text without its stamps or the note about them, so neither lands in the document. */
export function withoutStamps(text: string): string {
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (line.includes(STAMP_NOTE.slice(0, 40))) continue;
    const bare = line.replace(STAMP, '');
    // A line that held only stamps (the export prints them on their own line) goes whole.
    if (bare !== line && !bare.replace(/[_*·\s]/g, '')) continue;
    kept.push(bare.replace(/[ \t]+$/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The stamp for this stage when it names a version older than the head: the
 * text was revised from that version. Null when there is no stamp for the
 * stage, or it names the head (nothing has changed here since).
 */
export function staleStamp(text: string, stageId: string, headVersion: number): VersionStamp | null {
  const mine = readStamps(text).filter((s) => s.stageId === stageId.toLowerCase());
  if (!mine.length) return null;
  const from = mine.reduce((a, b) => (b.version < a.version ? b : a));
  return from.version < headVersion ? from : null;
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Longest common subsequence of two line lists, as index pairs. */
function common(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export interface Edit {
  /** Lines of the old version this edit replaces or removes; empty for an addition. */
  removed: string[];
  /** Lines put in their place; empty for a removal. */
  added: string[];
  /** The unchanged line just before, to say where an addition goes. */
  after: string | null;
}

/** The user's edits: how their revision differs from the version they started from. */
export function editsBetween(before: string, after: string): Edit[] {
  const a = lines(before);
  const b = lines(after);
  const anchors = [...common(a, b), [a.length, b.length] as [number, number]];
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of anchors) {
    if (ai > i || bj > j) edits.push({ removed: a.slice(i, ai), added: b.slice(j, bj), after: i > 0 ? a[i - 1] : null });
    i = ai + 1;
    j = bj + 1;
  }
  return edits;
}

const quote = (ls: string[]) => ls.map((l) => `    ${l}`).join('\n');

/** The edits as an instruction a model applies to the current version. */
export function editsInstruction(edits: readonly Edit[], from: number, head: number): string {
  const listed = edits
    .map((e, n) => {
      const label = `${n + 1}.`;
      if (e.removed.length && e.added.length) return `${label} Replace\n${quote(e.removed)}\n  with\n${quote(e.added)}`;
      if (e.removed.length) return `${label} Remove\n${quote(e.removed)}`;
      return `${label} Add${e.after ? ` after\n${quote([e.after])}\n  this` : ' at the start'}\n${quote(e.added)}`;
    })
    .join('\n');
  return (
    `This revision was made outside PromptMaster, starting from version ${from}. The document is now at version ${head}: ` +
    `keep every change made since version ${from}. Apply only the user's own edits below, each where its text appears ` +
    `in the current version; where the current version already says something different there, keep the current wording ` +
    `unless the edit is plainly about that point.\n\n${listed}`
  );
}
