/**
 * Assessing many items against criteria set once (client, 25 Oct).
 *
 * The case that asked for it: an executive search screens LinkedIn profiles by
 * pasting a few at a time and wanting a colour-coded "screen them or not" for
 * each. Nothing here is about candidates. An Assess stage holds a table of
 * judged items and the scale they were judged on, and every paste appends —
 * so the same stage screens suppliers, proposals, grant applications or
 * anything else the earlier stages wrote criteria for.
 *
 * The document is the ordinary `stage_items` JSON (so counts, digests, the
 * chat and version history read it like any table) plus the scale. Pure.
 */

import type { StageItem, StageItemsDocument } from './stage-artifact';

export type VerdictTone = 'good' | 'caution' | 'bad' | 'neutral';

export interface ScaleLevel {
  /** What is stored on a row and sent to the model: the level's own name. */
  label: string;
  tone: VerdictTone;
  /** What earns this level; told to the model. */
  meaning?: string;
}

export interface AssessScale {
  /** A preset's id, or 'custom'. */
  id: string;
  /** Best level first. */
  levels: ScaleLevel[];
}

export const SCALE_LIMITS = { minLevels: 2, maxLevels: 7, labelMax: 40, meaningMax: 300 } as const;
/**
 * What one paste may carry (15 Nov, Sean: "it will only do like 12 people at a
 * time … can we make it a big amount?"). The page sends it a batch at a time.
 */
export const ASSESS_PASTE_MAX = 200_000;
/** What one call carries; the server holds the same bound (assessment.MAX_ASSESS_CHARS). */
export const ASSESS_CALL_MAX = 40_000;
/** Calls one paste may take: twelve items each, 240 in all. */
export const ASSESS_MAX_CALLS = 20;

/** The scales offered without typing one. Labels are stored in English and shown translated. */
export const SCALE_PRESETS: AssessScale[] = [
  {
    id: 'traffic',
    levels: [
      { label: 'Green', tone: 'good', meaning: 'Meets the must-haves: worth taking forward.' },
      { label: 'Amber', tone: 'caution', meaning: 'Close, with a gap or an open question worth checking.' },
      { label: 'Red', tone: 'bad', meaning: 'Misses a must-have, or hits a deal-breaker.' },
    ],
  },
  {
    id: 'score5',
    levels: [
      { label: '5', tone: 'good', meaning: 'Excellent: meets every criterion, with strengths beyond them.' },
      { label: '4', tone: 'good', meaning: 'Strong: meets every must-have.' },
      { label: '3', tone: 'caution', meaning: 'Adequate: meets most must-haves, with gaps.' },
      { label: '2', tone: 'bad', meaning: 'Weak: misses several criteria.' },
      { label: '1', tone: 'bad', meaning: 'Poor: misses the must-haves.' },
    ],
  },
  {
    id: 'pass_fail',
    levels: [
      { label: 'Pass', tone: 'good', meaning: 'Meets every must-have.' },
      { label: 'Fail', tone: 'bad', meaning: 'Misses at least one must-have.' },
    ],
  },
  {
    id: 'grade',
    levels: [
      { label: 'A', tone: 'good', meaning: 'Outstanding.' },
      { label: 'B', tone: 'good', meaning: 'Good: meets the criteria.' },
      { label: 'C', tone: 'caution', meaning: 'Acceptable, with gaps.' },
      { label: 'D', tone: 'bad', meaning: 'Below the bar.' },
      { label: 'F', tone: 'bad', meaning: 'Does not meet the criteria.' },
    ],
  },
  {
    id: 'fit',
    levels: [
      { label: 'Strong fit', tone: 'good', meaning: 'Clearly matches what the criteria ask for.' },
      { label: 'Possible fit', tone: 'caution', meaning: 'Partly matches; worth a closer look.' },
      { label: 'Not a fit', tone: 'bad', meaning: 'Does not match the criteria.' },
    ],
  },
];

export const DEFAULT_SCALE = SCALE_PRESETS[0];

export function presetScale(id: string | undefined): AssessScale | undefined {
  return SCALE_PRESETS.find((s) => s.id === id);
}

/** A scale the user typed, as levels: one per line, best first, tones spread from good to bad. */
export function customScale(lines: string): AssessScale {
  const labels = lines
    .split('\n')
    .map((l) => l.trim().slice(0, SCALE_LIMITS.labelMax))
    .filter(Boolean)
    .filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i)
    .slice(0, SCALE_LIMITS.maxLevels);
  return { id: 'custom', levels: labels.map((label, i) => ({ label, tone: toneAt(i, labels.length) })) };
}

/** Best is good, worst is bad, and the middle is caution. */
export function toneAt(index: number, count: number): VerdictTone {
  if (count < 2) return 'neutral';
  const at = index / (count - 1);
  return at <= 0.25 ? 'good' : at >= 0.75 ? 'bad' : 'caution';
}

export function validScale(scale: AssessScale | null | undefined): scale is AssessScale {
  return Boolean(
    scale &&
      scale.levels.length >= SCALE_LIMITS.minLevels &&
      scale.levels.length <= SCALE_LIMITS.maxLevels &&
      scale.levels.every((l) => l.label.trim())
  );
}

export interface AssessmentDocument extends StageItemsDocument {
  scale: AssessScale;
  /**
   * What a paste left unjudged (15 Nov: "13 more were in the paste; assess them
   * in another batch", and the 13 were gone). Kept with the table until judged.
   */
  pending?: AssessPending;
}

export interface AssessPending {
  text: string;
  /** How many items the last call said were left, when it said. */
  count: number;
}

/** The scale and rows a version holds; null when it is not an assessment. */
export function parseAssessment(content: string | null | undefined): { scale: AssessScale | null; items: StageItem[]; pending: AssessPending | null } | null {
  if (!content?.trim()) return null;
  try {
    const doc = JSON.parse(content) as Partial<AssessmentDocument>;
    if (doc?.kind !== 'stage_items' || !Array.isArray(doc.items)) return null;
    const scale = doc.scale && Array.isArray(doc.scale.levels) ? (doc.scale as AssessScale) : null;
    const pending = doc.pending && typeof doc.pending.text === 'string' && doc.pending.text.trim()
      ? { text: doc.pending.text, count: Number(doc.pending.count) || 0 }
      : null;
    return { scale: validScale(scale) ? scale : null, items: doc.items.filter((i): i is StageItem => Boolean(i && typeof i.id === 'string')), pending };
  } catch {
    return null;
  }
}

export function serializeAssessment(scale: AssessScale, items: StageItem[], pending?: AssessPending | null): string {
  const doc: AssessmentDocument = { kind: 'stage_items', scale, items, ...(pending?.text.trim() ? { pending } : {}) };
  return JSON.stringify(doc, null, 2);
}

/** A name as compared for duplicates: case, spacing and punctuation aside. */
export function subjectKey(subject: string | undefined): string {
  return (subject ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** What one call carries of the rest of a paste: up to `max`, ending at a blank line, or a line, so no item is cut. */
export function batchChunk(text: string, max = ASSESS_CALL_MAX): string {
  if (text.length <= max) return text;
  const blank = text.lastIndexOf('\n\n', max);
  if (blank > max / 2) return text.slice(0, blank);
  const line = text.lastIndexOf('\n', max);
  return text.slice(0, line > max / 2 ? line : max);
}

/**
 * The rest of a paste after a call: from where the first unjudged item starts,
 * '' when nothing is left, or null when the call said items were left but its
 * starting line cannot be found (the caller keeps the rest as pending).
 */
export function restAfter(rest: string, chunk: string, res: { not_assessed?: number; next_from?: string }): string | null {
  if ((res.not_assessed ?? 0) > 0) {
    const start = (res.next_from ?? '').trim();
    if (!start) return null;
    const words = start.split(/\s+/).slice(0, 12).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const found = new RegExp(words.join('\\s+')).exec(rest.slice(1));
    return found ? rest.slice(found.index + 1).trim() : null;
  }
  return chunk.length < rest.length ? rest.slice(chunk.length).trim() : '';
}

/** A returned row as the table stores it. */
/**
 * What an Assess stage is waiting for, or null when it has rows to show: a batch
 * it was given (a curated example's sample), or one the user has to paste. Go can
 * judge the first; the second only the user can supply.
 */
export function batchAwaited(
  stage: { renderer: string; assess?: { offered_batch?: string; item_noun?: string } },
  head: string | null | undefined
): { offered: boolean; noun: string | null } | null {
  if (stage.renderer !== 'assess') return null;
  const doc = parseAssessment(head);
  // Items a paste left unjudged are the user's own, given already: Go judges them (15 Nov).
  if (doc?.pending?.text.trim()) return { offered: true, noun: stage.assess?.item_noun?.trim() || null };
  if (doc?.items.length) return null;
  return { offered: Boolean(stage.assess?.offered_batch?.trim()), noun: stage.assess?.item_noun?.trim() || null };
}

export interface AssessedRow {
  id: string;
  subject: string;
  verdict: string;
  rationale: string;
  evidence: string;
  gaps: string;
}

/**
 * The table after a batch: what was there, then the new rows, each stamped
 * with its batch number and when it was judged. The model's verdict is kept
 * beside the row's, so a verdict the user changes says what it was.
 */
export function appendBatch(existing: StageItem[], rows: AssessedRow[], at: string): StageItem[] {
  const batch = String(nextBatch(existing));
  // A name already in the table is not added twice (15 Nov: carrying a paste on,
  // or pasting the same profiles again, duplicated rows).
  const seen = new Set(existing.map((i) => subjectKey(i.subject)).filter(Boolean));
  const fresh = rows.filter((r) => {
    const key = subjectKey(r.subject);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [
    ...existing,
    ...fresh.map((r) => ({
      id: r.id,
      subject: r.subject,
      verdict: r.verdict,
      rationale: r.rationale,
      evidence: r.evidence,
      gaps: r.gaps,
      batch,
      assessed_at: at,
      model_verdict: r.verdict,
      verdict_source: r.verdict ? 'model' : '',
    })),
  ];
}

export function nextBatch(items: StageItem[]): number {
  return items.reduce((n, i) => Math.max(n, Number.parseInt(i.batch ?? '0', 10) || 0), 0) + 1;
}

/** The user's verdict on a row; the model's stays on `model_verdict`. */
export function setVerdict(items: StageItem[], id: string, verdict: string): StageItem[] {
  return items.map((i) => (i.id === id ? { ...i, verdict, verdict_source: verdict && verdict === i.model_verdict ? 'model' : 'user' } : i));
}

export function levelOf(scale: AssessScale, verdict: string | undefined): ScaleLevel | undefined {
  return verdict ? scale.levels.find((l) => l.label === verdict) : undefined;
}

/** How many rows sit at each level, in scale order, then the ungraded ones. */
export function verdictCounts(scale: AssessScale, items: StageItem[]): { label: string; tone: VerdictTone; count: number }[] {
  const counts = scale.levels.map((l) => ({ label: l.label, tone: l.tone, count: items.filter((i) => i.verdict === l.label).length }));
  const ungraded = items.filter((i) => !levelOf(scale, i.verdict)).length;
  return ungraded ? [...counts, { label: '', tone: 'neutral' as const, count: ungraded }] : counts;
}

/** Rows best first, then by batch, newest batch first within a level. */
export function sortByVerdict(scale: AssessScale, items: StageItem[]): StageItem[] {
  const rank = (i: StageItem) => {
    const at = scale.levels.findIndex((l) => l.label === i.verdict);
    return at < 0 ? scale.levels.length : at;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || (Number(b.batch) || 0) - (Number(a.batch) || 0));
}

const CSV_COLUMNS = ['subject', 'verdict', 'rationale', 'evidence', 'gaps', 'batch', 'assessed_at'] as const;

/** The table as CSV, for a spreadsheet or an ATS. */
export function assessmentCsv(items: StageItem[], headers: Record<(typeof CSV_COLUMNS)[number], string>): string {
  const cell = (v: string | undefined) => {
    const s = (v ?? '').replace(/\r?\n/g, ' ').trim();
    // A leading = + - @ is a formula to a spreadsheet; quoted with a ' it is text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [CSV_COLUMNS.map((c) => cell(headers[c])).join(','), ...items.map((i) => CSV_COLUMNS.map((c) => cell(i[c])).join(','))].join('\n');
}

/** The table as rows of plain cells, headers first, for a workbook. */
export function assessmentRows(items: StageItem[], headers: Record<(typeof CSV_COLUMNS)[number], string>): string[][] {
  const cell = (v: string | undefined) => (v ?? '').replace(/\r?\n/g, ' ').trim();
  return [CSV_COLUMNS.map((c) => cell(headers[c])), ...items.map((i) => CSV_COLUMNS.map((c) => cell(i[c])))];
}

/** The scale as the server takes it. */
export function scaleForRequest(scale: AssessScale): { levels: { value: string; label: string; meaning: string }[] } {
  return { levels: scale.levels.map((l) => ({ value: l.label, label: l.label, meaning: l.meaning ?? '' })) };
}

/** The scale a stage offers before its first batch: its preset, its own levels, or the traffic light. */
export function scaleFromSpec(spec: { scale: string | ScaleLevel[] } | undefined): AssessScale {
  if (!spec) return DEFAULT_SCALE;
  if (typeof spec.scale === 'string') return presetScale(spec.scale) ?? DEFAULT_SCALE;
  const custom: AssessScale = { id: 'custom', levels: spec.scale.slice(0, SCALE_LIMITS.maxLevels) };
  return validScale(custom) ? custom : DEFAULT_SCALE;
}
