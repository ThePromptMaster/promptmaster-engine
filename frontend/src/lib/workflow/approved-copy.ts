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
 */

import { countWords } from './measurable';
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

/** A finding that asks for an approved text word for word. */
export const ASKS_VERBATIM = /\b(?:verbatim|word[- ]for[- ]word|exact(?:ly)? (?:as approved|text|wording)|unchanged from the approved)\b/i;

export interface ApprovedSource {
  stageId: string;
  label: string;
  shortLabel: string;
  /** The approved version's text, without its own title or count line. */
  text: string;
  version: number;
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

/** The stages whose approval the user gave, with the text of the version it was given on (the head when unknown). */
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
    const version = (on ? versions.find((v) => v.id === on) : undefined) ?? versions.at(-1);
    if (!version?.content?.trim() || /^\s*[{[]/.test(version.content)) continue;
    const labels = [stage.label, stage.short_label ?? ''];
    out.push({ stageId: stage.id, label: stage.label, shortLabel: stage.short_label ?? '', text: approvedBody(version.content, labels), version: version.version_number });
  }
  return out;
}

/** The approved source a finding asks for word for word, or null. */
export function sourceAskedFor(finding: string, sources: readonly ApprovedSource[], holderId: string): ApprovedSource | null {
  if (!ASKS_VERBATIM.test(finding)) return null;
  const said = norm(finding);
  const named = sources.filter((s) => s.stageId !== holderId && [s.label, s.shortLabel].some((l) => l.trim() && said.includes(norm(l))));
  return named.length === 1 ? named[0] : null;
}

/** A stated length: "Length: 698 words", "Word count: 104", "(110 words)". */
const STATED_COUNT = /(?:word count\s*[:=-]?\s*|length\s*[:=-]?\s*)?(\d[\d,]*)\s+words\b(?:,?\s*counted by hand)?/i;

/** The section number a finding names: "Section 6", "section 6 of the package". */
const sectionNumber = (finding: string) => /\bsection\s+(\d{1,2})\b/i.exec(finding)?.[1] ?? null;

/**
 * `content` with the section for `source` holding its approved text, and a counted
 * word line under it. Null when no section can be found for it, or it already holds
 * the text as approved.
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
  const next = headings.find((h) => h.at > hit.at && h.m[1].length <= level);
  const end = next ? next.at : lines.length;
  const body = lines.slice(hit.at + 1, end).join('\n');
  const words = countWords(source.text);
  if (norm(body).includes(norm(source.text))) {
    // Already copied (19 Nov production pass: as a quotation, "Length: 698 words", counted by
    // hand; code counts 676). The count beside it is the code's.
    const at = lines.findIndex((l, i) => i > hit.at && i < end && STATED_COUNT.test(l) && !norm(source.text).includes(norm(l)));
    if (at < 0) {
      const counted = `*${words} words, counted — ${source.label} v${source.version} as approved.*`;
      return { content: [...lines.slice(0, hit.at + 1), '', counted, ...lines.slice(hit.at + 1)].join('\n'), words };
    }
    const stated = Number((STATED_COUNT.exec(lines[at])?.[1] ?? '').replace(/,/g, ''));
    if (stated === words) return null;
    const fixed = lines[at].replace(STATED_COUNT, (m: string, n: string) => m.replace(n, String(words)).replace(/\s*(?:,\s*)?counted by hand/i, '') + (/counted/i.test(m) ? '' : ' (counted)'));
    return { content: [...lines.slice(0, at), fixed, ...lines.slice(at + 1)].join('\n'), words };
  }
  const copied = ['', source.text, '', `*${words} words, counted — ${source.label} v${source.version} as approved, copied word for word.*`, ''];
  return { content: [...lines.slice(0, hit.at + 1), ...copied, ...lines.slice(end)].join('\n'), words };
}
