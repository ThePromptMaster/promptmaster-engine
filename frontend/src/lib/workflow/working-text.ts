/**
 * The model's own working left in a document (7 Nov, production): a package saved
 * with "= **$45,000**? see below", "Correction to the total line above:" and a
 * wrong table followed by a right one. Deterministic, and narrow on purpose: a
 * document may legitimately be about corrections, so only self-correction
 * counts. Pure.
 */

const NOTES: readonly RegExp[] = [
  /\?\s*\*{0,2}\s*see below\b/i,
  /^\W*correction to (?:the )?[^\n]{0,60}\babove\b/i,
  /\brecalculated here\b/i,
  /^\W*(?:wait|hmm|scratch that|on second thought)\b\s*[,:.—–-]/i,
  /\blet me (?:recalculate|recompute|redo|re-?check|correct that|fix that)\b/i,
];

function clip(line: string): string {
  const t = line.trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** A row of three or more cells, at least two of them holding something: "| a | b | c |". */
function rowKey(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith('|') || /^\|[\s:|-]+\|?$/.test(t)) return null;
  const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().toLowerCase());
  return cells.length >= 3 && cells.filter(Boolean).length >= 2 ? cells.join('|') : null;
}

/** The lines of `text` that are the writer's working rather than the document: quoted, at most six. */
export function strayWorkingText(text: string): string[] {
  const out: string[] = [];
  let table = new Set<string>();
  for (const line of text.replace(/\\n/g, '\n').split('\n')) {
    if (NOTES.some((re) => re.test(line))) out.push(clip(line));
    if (!line.trim().startsWith('|')) {
      table = new Set();
      continue;
    }
    const key = rowKey(line);
    if (!key) continue;
    if (table.has(key)) out.push(clip(line));
    table.add(key);
  }
  return [...new Set(out)].slice(0, 6);
}

/** As a sentence for a message. */
export function describeWorkingText(lines: readonly string[]): string {
  return lines.map((l) => `"${l}"`).join('; ');
}

/** Raised instead of saving such a version: it fails the step, and the current version stands. */
export class WorkingTextInSave extends Error {
  constructor(label: string, lines: readonly string[]) {
    super(`The new version of ${label} still holds the model's working, so it was not saved: ${describeWorkingText(lines)}. The current version stands.`);
    this.name = 'WorkingTextInSave';
  }
}
