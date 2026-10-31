import type { ProjectSource } from '@/types/project';

/**
 * The project's saved web sources and their numbers, [S1], [S2], …. Pure.
 *
 * A source's number is its place among the project's current sources, oldest
 * first (20 Oct), so [S1] keeps its number as more are saved.
 *
 * 31 Oct (Sean, a book at v8): "The draft cites S41–S45 (retrieved 2026-10-29),
 * but the project's saved source list ends at S40." They were saved; the panel
 * and every prompt stopped at the fortieth. The panel now lists every source,
 * and a request sends at most 40 — those the text being worked on cites, then
 * the newest — each with its number, so [S41] means the same thing everywhere.
 */
export const MAX_SOURCES_SENT = 40;

/** Every current source, oldest first. */
export function currentSources(sources: readonly ProjectSource[] | undefined): ProjectSource[] {
  return (sources ?? []).filter((s) => !s.retired_at);
}

/** Each current source with its number. */
export function numberedSources(sources: readonly ProjectSource[] | undefined): { source: ProjectSource; n: number }[] {
  return currentSources(sources).map((source, i) => ({ source, n: i + 1 }));
}

const CITATION = /\[S(\d{1,4})\]/g;

/** The [S n] a text cites, in the order first cited. */
export function citedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of (text ?? '').matchAll(CITATION)) {
    const n = Number(m[1]);
    if (n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * As `PMInput.sources`: at most 40, each with its number. First the sources
 * `citing` already cites (a revision must be able to keep its citations), then
 * the newest. The newest is always sent, so a search's finds are numbered
 * after the last source saved — which is where `saveSources` appends them.
 */
export function sourcesForRequest(sources: readonly ProjectSource[] | undefined, citing = '') {
  const all = numberedSources(sources);
  let chosen = all;
  if (all.length > MAX_SOURCES_SENT) {
    const byNumber = new Map(all.map((e) => [e.n, e]));
    const cited = citedNumbers(citing)
      .map((n) => byNumber.get(n))
      .filter((e): e is (typeof all)[number] => Boolean(e))
      .slice(0, MAX_SOURCES_SENT - 1);
    const picked = new Set(cited.map((e) => e.n));
    const newest = [...all].reverse().filter((e) => !picked.has(e.n)).slice(0, MAX_SOURCES_SENT - cited.length);
    chosen = [...cited, ...newest].sort((a, b) => a.n - b.n);
  }
  return chosen.map(({ source: s, n }) => ({ url: s.url, title: s.title, excerpt: s.excerpt, retrieved: s.retrieved_at.slice(0, 10), n }));
}

/**
 * What a search's provisional numbers become once saved. The backend numbers
 * what it found after the highest number sent; `saveSources` skips a link the
 * project already holds, so such a find — and every find after it — may be
 * saved under another number. Only numbers that change are in the map.
 */
export function savedNumbers(before: readonly ProjectSource[] | undefined, found: readonly { url: string }[], saved: readonly ProjectSource[]): Map<number, number> {
  const start = currentSources(before).length;
  const after = numberedSources([...currentSources(before), ...saved]);
  const byUrl = new Map(after.map((e) => [e.source.url, e.n]));
  const map = new Map<number, number>();
  found.forEach((f, i) => {
    const provisional = start + i + 1;
    const actual = byUrl.get(f.url);
    if (actual && actual !== provisional) map.set(provisional, actual);
  });
  return map;
}

/** Citations rewritten to the numbers the sources were saved under; one pass, so 41→43 and 43→41 both hold. */
export function renumberCitations(text: string, map: ReadonlyMap<number, number>): string {
  if (!map.size || !text) return text;
  return text.replace(CITATION, (whole, n: string) => {
    const to = map.get(Number(n));
    return to ? `[S${to}]` : whole;
  });
}

const LIST_HEADING =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources(?:\s+(?:cited|used|on record|consulted))?|references|works cited|bibliography|citations)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const ANY_HEADING = /^\s*(?:#{1,6}\s+\S|(?:\*\*|__)[^*_]+(?:\*\*|__)\s*:?\s*$)/;
/** "| S40 | …", "- [S3] Title — link", "3. [S3] …", "S12. …", "**[S4]** …". */
const ENTRY = /^\s*(?:[-*+]\s+|\d{1,3}[.)]\s+)?(?:\|\s*)?(?:\*\*|__)?\[?S\d{1,4}\]?(?:\*\*|__)?(?=[\s|.:,—–)-]|$)/;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/** A line of a sources list: an entry, or the table's header or rule. */
export function isSourceListLine(line: string): boolean {
  return ENTRY.test(line) || TABLE_RULE.test(line);
}

/**
 * The text without the Sources lists the model wrote into it (31 Oct): a
 * section headed Sources, References, Works cited or Bibliography whose every
 * line is an [S n] entry (or the table's header and rule). PromptMaster lists
 * the sources a text cites beneath it instead. A list with anything else in it
 * — a source the user typed, a note — is the user's, and is left alone.
 */
export function withoutSourcesList(text: string): string {
  if (!text || !/\bS\d/.test(text)) return text;
  const lines = text.split('\n');
  const keep = new Array(lines.length).fill(true);
  let removed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!LIST_HEADING.test(lines[i])) continue;
    let end = i + 1;
    // The section runs to the next heading of any kind.
    while (end < lines.length && !ANY_HEADING.test(lines[end]) && !LIST_HEADING.test(lines[end])) end += 1;
    const body = lines.slice(i + 1, end).filter((l) => l.trim());
    const entries = body.filter((l) => ENTRY.test(l)).length;
    // The first non-blank line may be the table's header ("| # | Source | Link |").
    const ok = entries > 0 && body.every((l, idx) => isSourceListLine(l) || (idx === 0 && TABLE_ROW.test(l)));
    if (!ok) continue;
    for (let k = i; k < end; k += 1) keep[k] = false;
    // A rule ("---") just before the heading went with it.
    let j = i - 1;
    while (j >= 0 && !lines[j].trim()) j -= 1;
    if (j >= 0 && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[j])) keep[j] = false;
    removed = true;
    i = end - 1;
  }
  if (!removed) return text;
  return lines.filter((_, k) => keep[k]).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, text.endsWith('\n') ? '\n' : '');
}

/** The sources a text cites, as PromptMaster lists them beneath it; unknown numbers are left out. */
export function sourcesCitedIn(text: string, sources: readonly ProjectSource[] | undefined): { n: number; source: ProjectSource }[] {
  const byNumber = new Map(numberedSources(sources).map((e) => [e.n, e.source]));
  return citedNumbers(text)
    .sort((a, b) => a - b)
    .map((n) => ({ n, source: byNumber.get(n) }))
    .filter((e): e is { n: number; source: ProjectSource } => Boolean(e.source));
}

/** The same list as Markdown, for an export: "" when the text cites none. */
export function sourcesSection(text: string, sources: readonly ProjectSource[] | undefined, heading = 'Sources'): string {
  const cited = sourcesCitedIn(text, sources);
  if (!cited.length) return '';
  return `## ${heading}\n\n${cited
    .map(({ n, source: s }) => `- [S${n}] ${s.title || s.url} — ${s.url} (retrieved ${s.retrieved_at.slice(0, 10)})`)
    .join('\n')}\n`;
}
