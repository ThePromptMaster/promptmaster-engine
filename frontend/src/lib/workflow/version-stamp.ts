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
  /** The heading the edit sits under in the old version, if any. */
  heading: string | null;
  /** The unchanged line just after, if any. */
  next: string | null;
}

const isHeading = (line: string) => /^#{1,6}\s/.test(line);

/** The user's edits: how their revision differs from the version they started from. */
export function editsBetween(before: string, after: string): Edit[] {
  const a = lines(before);
  const b = lines(after);
  const anchors = [...common(a, b), [a.length, b.length] as [number, number]];
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of anchors) {
    if (ai > i || bj > j) {
      const heading = a.slice(0, i).reverse().find(isHeading) ?? null;
      edits.push({ removed: a.slice(i, ai), added: b.slice(j, bj), after: i > 0 ? a[i - 1] : null, heading, next: ai < a.length ? a[ai] : null });
    }
    i = ai + 1;
    j = bj + 1;
  }
  return edits;
}

const quote = (ls: string[]) => ls.map((l) => `    ${l}`).join('\n');

/** The opening words of a line: enough to find it, not its figures. */
const opening = (line: string) => {
  const words = line.split(/\s+/);
  return words.length > 6 ? `${words.slice(0, 6).join(' ')} …` : line;
};

/**
 * Where an addition goes, named by headings where there are any. Quoting the
 * whole line before it put that line's old figures back in front of the model
 * and the conflict check (18 Oct, production pass: "$18,000", which the user
 * had not touched, was asked about).
 */
function place(e: Edit): string {
  if (e.next && isHeading(e.next)) return e.heading ? `under "${e.heading}", just before "${e.next}"` : `just before "${e.next}"`;
  if (e.after && isHeading(e.after)) return `straight after "${e.after}"`;
  if (e.heading) return `under "${e.heading}"${e.after ? `, after the line that begins "${opening(e.after)}"` : ''}`;
  return e.after ? `after the line that begins "${opening(e.after)}"` : 'at the start';
}

/** The edits as an instruction a model applies to the current version. */
export function editsInstruction(edits: readonly Edit[], from: number, head: number): string {
  const listed = edits
    .map((e, n) => {
      const label = `${n + 1}.`;
      if (e.removed.length && e.added.length) return `${label} Replace\n${quote(e.removed)}\n  with\n${quote(e.added)}`;
      if (e.removed.length) return `${label} Remove\n${quote(e.removed)}`;
      return `${label} Add ${place(e)}\n${quote(e.added)}`;
    })
    .join('\n');
  return (
    `This revision was made outside PromptMaster, starting from version ${from}. The document is now at version ${head}: ` +
    `keep every change made since version ${from}. Apply only the user's own edits below, each where its text appears ` +
    `in the current version; where the current version already says something different there, keep the current wording ` +
    `unless the edit is plainly about that point.\n\n${listed}`
  );
}

export type ResolvedInstruction = { ask: string; revisedFrom?: { version: number; head: number; edits: number } } | { error: string };

/**
 * What a typed instruction asks for, as it will be sent. Text pasted back from
 * an export whose stamp names an older version of this stage becomes the
 * user's edits against that version, so "Change it" and the conflict check
 * read the same thing, and neither sees a value the user did not touch.
 */
export async function resolveInstruction(
  typed: string,
  o: { wholeDocument: boolean; stageId: string; head: { version_number: number } | null; loadVersion: (n: number) => Promise<{ content: string } | undefined> }
): Promise<ResolvedInstruction> {
  const text = withoutStamps(typed) || typed;
  const stale = o.wholeDocument && o.head ? staleStamp(typed, o.stageId, o.head.version_number) : null;
  if (!stale || !o.head) return { ask: text };
  const base = await o.loadVersion(stale.version);
  if (!base) return { ask: text };
  const edits = editsBetween(withoutStamps(base.content), text);
  const head = o.head.version_number;
  if (!edits.length) return { error: `This is version ${stale.version} unchanged — there is nothing to apply. The current version is ${head}.` };
  return { ask: editsInstruction(edits, stale.version, head), revisedFrom: { version: stale.version, head, edits: edits.length } };
}
