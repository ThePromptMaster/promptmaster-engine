/**
 * An approved stage's text, copied into the deliverable word for word, in code
 * (19 Nov). Pure.
 *
 * Sean, Scanner Readiness: "I approved Staff announcement v1, but the readiness
 * package still used an older copy in Section 6." The check asked for the approved
 * announcement verbatim; two repairs were told so in as many words, and each
 * paraphrased it (one added a sentence, the other dropped one), and the stale
 * "104 words" stayed in. A model is not needed to copy text. When an accepted
 * finding asks for an approved stage's text word for word, the section whose
 * heading names that stage (or the section number the finding gives) gets the
 * stage's text as approved, and its words counted in code.
 *
 * 21 Nov (Sean, launch readiness brief, L-267): the copy undid the work. A
 * "no conflict" row ("…matches the email word for word… Keep them verbatim in
 * the final brief and email") was read as "copy the approved Internal email",
 * and every save of the final put back Internal email v5, approved before v6,
 * over the Target line accepted change i19 had just written; three repairs, the
 * same line each time. The italic count line it added was read as a note left in
 * the work, and Go spent four steps trying to delete it. So: a copy is made only
 * when a row asks for an approved text, only of an approval given on the stage's
 * current version, never over another accepted change, and with no count line in
 * the work unless the row asks for one.
 */

import { countWords } from './measurable';
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

/** A finding that asks for an approved text word for word. */
export const ASKS_VERBATIM = /\b(?:verbatim|word[- ]for[- ]word|exact(?:ly)? (?:as approved|text|wording)|unchanged from the approved)\b/i;

/** The row is about an approved text: "the approved Staff announcement", "as approved". */
const SAYS_APPROVED = /\bapproved\b/i;

/** A row that asks for the copy's length to be shown: "and show its word count". */
const ASKS_COUNT = /\b(?:word count|count (?:its|the) words|(?:show|state|give|with) (?:its|the) (?:length|number of words))\b/i;

/** A count line this code wrote: "*67 words, counted — Internal email v5 as approved, copied word for word.*" */
const OWN_COUNT_LINE = /^\*\d[\d,]* words, counted — .+? v\d+ as approved(?:, copied word for word)?\.\*\s*$/;

export interface ApprovedSource {
  stageId: string;
  label: string;
  shortLabel: string;
  /** The approved version's text, without its own title or count line. */
  text: string;
  version: number;
  /**
   * The stage's current version, when the approval was given on an earlier one.
   * Such a text is not copied: it would undo what changed since (20 Nov, an
   * announcement's v1 put back while v2 was current; 21 Nov, Internal email v5).
   */
  outdated?: { head: number };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A line that only states a length: "Word count: 104", "(110 words)", "110 words, counted". */
const COUNT_LINE = /^\s*[*_(]*\s*(?:word count\s*[:=-]?\s*\d[\d,]*|\d[\d,]*\s+words?\b[^.\n]{0,40})[\s.)*_]*$/i;

/** The approved text as it would sit in another document: no title of its own, no count line. */
export function approvedBody(text: string, labels: readonly string[]): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^#{1,6}\s/.test(lines[0]) && labels.some((l) => l && norm(lines[0]).includes(norm(l)))) lines.shift();
  const kept = lines.filter((l) => !COUNT_LINE.test(l));
  return kept.join('\n').trim();
}

/**
 * The stages whose approval the user gave, with the text of the version it was
 * given on (the head when unknown). One given on an earlier version than the
 * stage's head is marked `outdated`, and is not copied.
 */
export function approvedSources(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined,
  manualChecks: Record<string, boolean> | null | undefined,
  approvedVersions?: Record<string, string> | null
): ApprovedSource[] {
  const out: ApprovedSource[] = [];
  for (const stage of template.stages) {
    const approval = stage.exit_criteria.find((c) => c.check === 'manual' && manualChecks?.[c.id]);
    if (!approval) continue;
    const versions = bundles?.[stage.id]?.versions ?? [];
    const on = approvedVersions?.[approval.id];
    const head = versions.at(-1);
    const version = (on ? versions.find((v) => v.id === on) : undefined) ?? head;
    if (!version?.content?.trim() || /^\s*[{[]/.test(version.content)) continue;
    const labels = [stage.label, stage.short_label ?? ''];
    out.push({
      stageId: stage.id, label: stage.label, shortLabel: stage.short_label ?? '', text: approvedBody(version.content, labels), version: version.version_number,
      ...(head && head.id !== version.id ? { outdated: { head: head.version_number } } : {}),
    });
  }
  return out;
}

/**
 * The approved source a finding asks for word for word, or null. It has to ask
 * for an approved text, as `copiesApproved` does: "Keep them verbatim in the
 * final brief and email" asks to keep four statements, not to copy the stage
 * whose short label is "Email" (21 Nov).
 */
export function sourceAskedFor(finding: string, sources: readonly ApprovedSource[], holderId: string): ApprovedSource | null {
  if (!ASKS_VERBATIM.test(finding) || !SAYS_APPROVED.test(finding)) return null;
  const said = norm(finding);
  const named = sources.filter((s) => s.stageId !== holderId && [s.label, s.shortLabel].some((l) => l.trim() && said.includes(norm(l))));
  return named.length === 1 ? named[0] : null;
}

/** The text's headings moved below `level`, so they sit inside the section that holds it. */
export function nested(text: string, level: number): string {
  const levels = text.split('\n').map((l) => /^(#{1,6})\s/.exec(l)?.[1].length ?? 0).filter(Boolean);
  if (!levels.length) return text;
  const shift = Math.max(0, level + 1 - Math.min(...levels));
  if (!shift) return text;
  return text.split('\n').map((l) => l.replace(/^(#{1,6})(?=\s)/, (h) => '#'.repeat(Math.min(6, h.length + shift)))).join('\n');
}

/** A stated length: "Length: 698 words", "Word count: 104", "(110 words)". */
const STATED_COUNT = /(?:word count\s*[:=-]?\s*|length\s*[:=-]?\s*)?(\d[\d,]*)\s+words\b(?:,?\s*counted by hand)?/i;

/** The section number a finding names: "Section 6", "section 6 of the package". */
const sectionNumber = (finding: string) => /\bsection\s+(\d{1,2})\b/i.exec(finding)?.[1] ?? null;

/**
 * `content` with the section for `source` holding its approved text. A counted word
 * line goes under it only when the finding asks for the count ("and show its word
 * count"); a count the section already states is corrected to the code's. Null when
 * no section can be found for it, or it already holds the text as approved.
 */
export function withApprovedCopy(content: string, source: ApprovedSource, finding: string): { content: string; words: number } | null {
  const lines = content.split('\n');
  const headings = lines
    .map((line, at) => ({ at, m: /^(#{1,6})\s+(.*)$/.exec(line) }))
    .filter((h): h is { at: number; m: RegExpExecArray } => Boolean(h.m));
  const labels = [source.label, source.shortLabel].filter((l) => l.trim()).map(norm);
  const number = sectionNumber(finding);
  const byNumber = number ? headings.filter((h) => new RegExp(`^(?:section\\s+)?${number}\\b[.:)]?`, 'i').test(h.m[2].trim())) : [];
  const byLabel = headings.filter((h) => labels.some((l) => norm(h.m[2]).includes(l)));
  const hit = byNumber.length === 1 ? byNumber[0] : byLabel.length === 1 ? byLabel[0] : null;
  if (!hit) return null;
  const level = hit.m[1].length;
  // The approved text's own headings are part of the section, at whatever level an
  // earlier copy left them (19 Nov production pass: copied at the section's own level,
  // its "## Recommended vendor" would have ended the section, and the next save copied it again).
  const own = new Set(source.text.split('\n').map((l) => /^#{1,6}\s+(.*)$/.exec(l)?.[1]).filter((t): t is string => Boolean(t)).map(norm));
  const next = headings.find((h) => h.at > hit.at && h.m[1].length <= level && !own.has(norm(h.m[2])));
  const end = next ? next.at : lines.length;
  const body = lines.slice(hit.at + 1, end).join('\n');
  const words = countWords(source.text);
  const nestedText = nested(source.text, level);
  const flat = lines.slice(hit.at + 1, end).some((l) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    return Boolean(h && h[1].length <= level && own.has(norm(h[2])));
  });
  // Line by line: a line that only begins with the approved one is a change, not the
  // copy (21 Nov, v16: "**Target:** Friday at 9 a.m., kept by…" passed as "already there").
  const have = new Set(body.split('\n').map(norm).filter(Boolean));
  const holds = source.text.split('\n').map(norm).filter(Boolean).every((l) => have.has(l));
  if (holds && !flat) {
    // Already copied (19 Nov production pass: as a quotation, "Length: 698 words", counted by
    // hand; code counts 676). The count beside it is the code's.
    const at = lines.findIndex((l, i) => i > hit.at && i < end && STATED_COUNT.test(l) && !norm(source.text).includes(norm(l)));
    if (at < 0) {
      if (!ASKS_COUNT.test(finding)) return null;
      const counted = `*${words} words, counted — ${source.label} v${source.version} as approved.*`;
      return { content: [...lines.slice(0, hit.at + 1), '', counted, ...lines.slice(hit.at + 1)].join('\n'), words };
    }
    const stated = Number((STATED_COUNT.exec(lines[at])?.[1] ?? '').replace(/,/g, ''));
    if (stated === words) return null;
    const fixed = lines[at].replace(STATED_COUNT, (m: string, n: string) => m.replace(n, String(words)).replace(/\s*(?:,\s*)?counted by hand/i, '') + (/counted/i.test(m) ? '' : ' (counted)'));
    return { content: [...lines.slice(0, at), fixed, ...lines.slice(at + 1)].join('\n'), words };
  }
  // Not in the work unless asked: an 80-word email took it to 82, and Go read it as a note to delete (21 Nov).
  const counted = ASKS_COUNT.test(finding) ? [`*${words} words, counted — ${source.label} v${source.version} as approved, copied word for word.*`, ''] : [];
  const copied = ['', nestedText, '', ...counted];
  return { content: [...lines.slice(0, hit.at + 1), ...copied, ...lines.slice(end)].join('\n'), words };
}

/** An accepted row, as the copy reads it. */
export interface CopyRow {
  id: string;
  finding: string;
  suggested_change: string;
}

const QUOTED = /[“"]([^”"\n]{10,400})[”"]/g;
/** A quote the change asks to be taken out, not written: "Remove "…"", the first half of "replace "…" with "…"". */
const TAKES_OUT = /\b(?:remove|delete|drop|cut|replace|instead of|not|never)\b[^“"]*$/i;

/** A row that asks for no change: "No change to these four statements…", "Keep them as they are". */
const KEEPS = /^\s*(?:no (?:change|edit|fix)s?\b|keep (?:it|them|this|these|the [^.]{0,40}?) (?:as (?:it is|they are)|unchanged|verbatim|word[- ]for[- ]word))/i;

/** Passages a row quotes, long enough to name a line: six words or more. */
function linesQuoted(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((m) => m[1].trim()).filter((q) => norm(q).split(' ').length >= 6);
}

/** The words a change asks to be written into the text, quoted: `write: "**Target:** Friday at 9 a.m., kept by…"`. */
export function wordsToWrite(change: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of change.matchAll(QUOTED)) {
    const before = change.slice(Math.max(from, m.index! - 60), m.index);
    from = m.index! + m[0].length;
    const quote = m[1].trim();
    if (norm(quote).split(' ').length < 4 || TAKES_OUT.test(before)) continue;
    out.push(quote);
  }
  return out;
}

/**
 * The text Go saves, with each approved text an accepted row asks for copied in
 * word for word, and what was done or not done, for the version's record (L-259,
 * L-267). A copy is not made:
 * - of an approval given on an earlier version than the stage's current one;
 * - while another accepted row changes that text: it quotes a line of it as it
 *   stands, or the copy would take away the quoted words it asks to write
 *   (21 Nov: i19's Target line, three times).
 * A count line this code once put in the work is taken out when no row asks for a
 * count (21 Nov: Go spent four steps deleting it, and it was put back each time).
 */
export function approvedCopiesFor(
  content: string,
  rows: readonly CopyRow[],
  sources: readonly ApprovedSource[],
  holderId: string
): { content: string; notes: string[] } {
  let text = content;
  const notes: string[] = [];
  let counted = false;
  for (const row of rows) {
    const asked = `${row.finding} ${row.suggested_change}`;
    const source = sourceAskedFor(asked, sources, holderId);
    if (!source) continue;
    if (source.outdated) {
      notes.push(`${source.label}: approved on v${source.version}, now v${source.outdated.head}, so not copied word for word until that approval is re-confirmed (${row.id})`);
      continue;
    }
    const done = withApprovedCopy(text, source, asked);
    if (ASKS_COUNT.test(asked)) counted = true;
    if (!done) continue;
    const before = norm(text);
    const after = norm(done.content);
    // Another accepted row changes the approved text: it quotes a line of it as it stands
    // (21 Nov hand pass: "e.g. …" fixes are paraphrased, so their own words can't be
    // looked for), or the copy would take away the words it asks to write.
    const approved = norm(source.text);
    const undone = rows.filter((other) =>
      other.id !== row.id && !KEEPS.test(other.suggested_change) && (
        linesQuoted(`${other.finding} ${other.suggested_change}`).some((q) => approved.includes(norm(q))) ||
        wordsToWrite(other.suggested_change).some((q) => before.includes(norm(q)) && !after.includes(norm(q)))
      ));
    if (undone.length) {
      notes.push(`${source.label} v${source.version} not copied over the text: accepted change${undone.length === 1 ? '' : 's'} ${undone.map((r) => r.id).join(', ')} change${undone.length === 1 ? 's' : ''} it (${row.id})`);
      continue;
    }
    text = done.content;
    notes.push(`${source.label} v${source.version} as approved, word for word, ${done.words} words counted in code (${row.id})`);
  }
  if (!counted) {
    const lines = text.split('\n');
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!OWN_COUNT_LINE.test(lines[i])) {
        kept.push(lines[i]);
        continue;
      }
      // The blank line that set it apart goes with it, so no gap is left.
      if (!lines[i + 1]?.trim() && (!kept.length || !kept.at(-1)!.trim())) i += 1;
    }
    if (kept.length < lines.length) {
      text = kept.join('\n');
      notes.push('took out the count line an earlier copy put in the work');
    }
  }
  return { content: text, notes };
}
