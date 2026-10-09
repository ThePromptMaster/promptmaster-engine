/**
 * Requirements PromptMaster can measure, measured in code (C1, 8 Oct).
 *
 * Sean, 7 Oct: an announcement checked and revised by Go was saved at 94 words
 * against a 120–180 brief (TeamNotes); another reported "105 words" that a
 * whitespace count put at 95 (TaskBoard); a five-question FAQ had no answers,
 * and Output was marked complete all the same. "Completion should also check
 * the actual word count and answered FAQ, rather than only whether an output
 * exists."
 *
 * A word range, a word limit, an exact number of questions, and that each
 * question is answered are facts about the saved text, so they are counted
 * here — never asked of a model. They read the objective, the constraints, the
 * output format and the accepted requirements; they become automatic, blocking
 * checks on the stages that produce what they describe (`buildStageContext`,
 * `evaluateStage`). Deliberately conservative: a sentence this does not
 * recognise measures nothing, rather than blocking on a guess.
 */

import { primaryArtifactKind } from './stage-artifact';
import type { StageDefinition } from './types';

export type MeasureKind = 'words' | 'questions';

export interface MeasurableRequirement {
  id: string;
  kind: MeasureKind;
  /** The thing measured ("announcement", "faq"), or '' for the whole deliverable. */
  subject: string;
  min?: number;
  max?: number;
  /** For questions: each must have an answer under it. */
  answered?: boolean;
  /** The words it was read from, for the checklist. */
  source: string;
}

export interface Measurement {
  id: string;
  label: string;
  satisfied: boolean;
  detail?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NUM = `(\\d{1,4}|${Object.keys(NUMBER_WORDS).join('|')})`;
const num = (raw: string) => NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw);

/** The deliverables a requirement may name. "FAQ" also matches "frequently asked questions". */
const SUBJECTS = [
  'announcement', 'faq', 'summary', 'email', 'letter', 'memo', 'abstract', 'post', 'report',
  'description', 'bio', 'introduction', 'overview', 'invitation', 'briefing', 'press release', 'statement', 'answer',
];
const SUBJECT_RE = new RegExp(`\\b(${SUBJECTS.join('|')}|frequently asked questions)s?\\b`, 'i');

function subjectNear(text: string, start: number, end: number): string {
  // "a 120–180-word announcement": after it. "the announcement must be 100–140 words": before it.
  const after = text.slice(end, end + 40).match(SUBJECT_RE);
  if (after) return canonical(after[1]);
  const before = text.slice(Math.max(0, start - 60), start);
  const all = [...before.matchAll(new RegExp(SUBJECT_RE.source, 'gi'))];
  return all.length ? canonical(all.at(-1)![1]) : '';
}

const canonical = (s: string) => (/frequently asked questions/i.test(s) ? 'faq' : s.toLowerCase());

/** The measurable requirements stated in these texts, de-duplicated. */
export function parseRequirements(texts: readonly string[]): MeasurableRequirement[] {
  const out = new Map<string, MeasurableRequirement>();
  const add = (r: Omit<MeasurableRequirement, 'id'>) => {
    const id = `${r.kind}:${r.subject || 'all'}`;
    if (!out.has(id)) out.set(id, { id, ...r });
  };
  for (const text of texts) {
    if (!text?.trim()) continue;
    const t = text.replace(/ /g, ' ');
    const patterns: [RegExp, (m: RegExpMatchArray) => Partial<MeasurableRequirement>][] = [
      [new RegExp(`${NUM}\\s*(?:–|—|-|to)\\s*${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ min: num(m[1]), max: num(m[2]) })],
      [new RegExp(`\\bexactly\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ min: num(m[1]), max: num(m[1]) })],
      [new RegExp(`\\b(?:under|fewer than|less than|at most|no more than|maximum of|a maximum of|up to|not (?:to )?exceed(?:ing)?)\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ max: num(m[1]) })],
      [new RegExp(`\\b(?:at least|a minimum of|minimum of|no fewer than|no less than)\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ min: num(m[1]) })],
    ];
    for (const [re, read] of patterns) {
      for (const m of t.matchAll(re)) {
        const r = read(m);
        if ((r.min ?? 0) > 20_000 || (r.max ?? 0) > 20_000) continue;
        add({ kind: 'words', subject: subjectNear(t, m.index!, m.index! + m[0].length), source: m[0].trim(), ...r });
      }
    }
    // "exactly five FAQ questions", "a five-question support FAQ", "5 FAQ questions".
    const questionPatterns = [
      new RegExp(`\\bexactly\\s+${NUM}\\s+(?:(?:faq|support|customer)\\s+)*questions?\\b`, 'gi'),
      new RegExp(`\\b${NUM}[\\s-]+questions?\\s+(?:(?:support|customer)\\s+)*(?:faq|frequently asked questions)\\b`, 'gi'),
      new RegExp(`\\b${NUM}\\s+(?:faq|frequently asked)\\s+questions?\\b`, 'gi'),
    ];
    for (const re of questionPatterns) {
      for (const m of t.matchAll(re)) {
        const n = num(m[1]);
        if (!n || n > 50) continue;
        add({ kind: 'questions', subject: 'faq', min: n, max: n, answered: true, source: m[0].trim() });
      }
    }
  }
  return [...out.values()];
}

// --- measuring --------------------------------------------------------------

interface Line {
  text: string;
  /** 1–6 for markdown, 7 for a bold-only line, 8 for a short "Label:" line; 0 when not a heading. */
  level: number;
}

const QUESTION_PREFIX = /^(?:[-*+]\s+|\d+[.)]\s+|q\s*\d*[.:)]\s*|question\s*\d*[.:)]\s*)/i;

function lines(text: string): Line[] {
  return text.split('\n').map((raw) => {
    const t = raw.trim();
    const md = t.match(/^(#{1,6})\s+(.*)$/);
    if (md) return { text: md[2].trim(), level: md[1].length };
    const bold = t.match(/^\*\*(.+?)\*\*:?$/) ?? t.match(/^__(.+?)__:?$/);
    if (bold) return { text: bold[1].trim(), level: 7 };
    if (/^[A-Z][^.?!]{1,58}:$/.test(t)) return { text: t.slice(0, -1), level: 8 };
    return { text: t, level: 0 };
  });
}

const plain = (s: string) => s.replace(/[*_`#>|]/g, ' ').replace(QUESTION_PREFIX, '').trim();
const isQuestion = (l: Line) => plain(l.text).endsWith('?');
/** Lines a count leaves out: notes about the text rather than the text. */
const NOTE = /^\W*(what changed|revision notes?|change notes?|notes?|word count|words?\s*:|\(\d+\s+words?\)|verification|assumptions?)\b/i;

/** The part of `text` that is about `subject`: under a heading naming it, or all of it. */
export function sectionFor(text: string, subject: string): string | null {
  const all = lines(text);
  if (!subject) return text;
  const named = (l: Line) => {
    const t = l.text.toLowerCase();
    return subject === 'faq' ? /\bfaq\b|frequently asked questions/.test(t) : t.includes(subject);
  };
  const start = all.findIndex((l) => l.level > 0 && !isQuestion(l) && named(l));
  if (start < 0) return null;
  const level = all[start].level;
  const out: string[] = [];
  for (const l of all.slice(start + 1)) {
    if (l.level > 0 && !isQuestion(l) && (l.level <= level || SUBJECT_RE.test(l.text) || NOTE.test(l.text))) break;
    out.push(l.level > 0 ? `# ${l.text}` : l.text);
  }
  return out.join('\n');
}

/** Words of prose, by whitespace, leaving out headings and notes about the text. */
export function countWords(text: string): number {
  return lines(text)
    .filter((l) => l.level === 0 && !NOTE.test(l.text))
    .map((l) => plain(l.text.replace(/^[-*+]\s+/, '')))
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The questions in a text and how many have an answer under them. */
export function countQuestions(text: string): { total: number; answered: number } {
  const all = lines(text);
  let total = 0;
  let answered = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (!isQuestion(all[i])) continue;
    total += 1;
    const body: string[] = [];
    for (const l of all.slice(i + 1)) {
      if (isQuestion(l) || (l.level > 0 && l.level <= 6)) break;
      body.push(plain(l.text.replace(/^a[.:)]\s*/i, '')));
    }
    if (body.join(' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 3) answered += 1;
  }
  return { total, answered };
}

const SUBJECT_LABEL: Record<string, string> = { faq: 'FAQ' };
const subjectLabel = (s: string) => SUBJECT_LABEL[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : 'The deliverable');

function rangeText(r: MeasurableRequirement): string {
  if (r.min !== undefined && r.max !== undefined) return r.min === r.max ? `exactly ${r.min}` : `${r.min}–${r.max}`;
  return r.max !== undefined ? `at most ${r.max}` : `at least ${r.min}`;
}

/**
 * Measure one requirement against one stage's text; null when the text holds
 * nothing it is about. `whole`: the stage itself is about the subject, so
 * with no heading naming it the whole text is what is measured.
 */
export function measure(r: MeasurableRequirement, text: string, whole = false): Measurement | null {
  const section = sectionFor(text, r.subject) ?? (whole ? text : null);
  if (section === null) return null;
  const name = subjectLabel(r.subject);
  if (r.kind === 'words') {
    const n = countWords(section);
    const ok = (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
    return { id: `measured.${r.id}`, label: `${name}: ${rangeText(r)} words`, satisfied: ok, ...(ok ? {} : { detail: `${n} words` }) };
  }
  const { total, answered } = countQuestions(section);
  const countOk = (r.min === undefined || total >= r.min) && (r.max === undefined || total <= r.max);
  const answeredOk = !r.answered || answered === total;
  const problems = [
    ...(countOk ? [] : [`${total} question${total === 1 ? '' : 's'}`]),
    ...(answeredOk ? [] : [`${total - answered} without an answer`]),
  ];
  return {
    id: `measured.${r.id}`,
    label: `${name}: ${rangeText(r)} questions${r.answered ? ', each answered' : ''}`,
    satisfied: problems.length === 0,
    ...(problems.length ? { detail: problems.join('; ') } : {}),
  };
}

/**
 * Which requirements a stage answers for. A requirement naming a deliverable
 * applies to a written stage that is about it (its label or instruction names
 * it) and to the project's deliverable stage, where it is looked for under a
 * heading; one naming nothing applies to the deliverable stage alone.
 */
export function requirementsForStage(
  stage: StageDefinition,
  deliverableId: string | undefined,
  requirements: readonly MeasurableRequirement[]
): { requirement: MeasurableRequirement; whole: boolean }[] {
  if (stage.renderer !== 'prose') return [];
  // The prompt a deliverable is made from, and a statement of the objective,
  // describe the deliverable; they are not it.
  const kind = primaryArtifactKind(stage) ?? '';
  if (kind === 'prompt' || kind.includes('objective')) return [];
  const about = `${stage.label} ${stage.entry_prompt_hint ?? ''}`.toLowerCase();
  const subjects = new Set(requirements.map((r) => r.subject));
  const out: { requirement: MeasurableRequirement; whole: boolean }[] = [];
  for (const r of requirements) {
    const aboutIt = Boolean(r.subject) && (r.subject === 'faq' ? /\bfaq\b|frequently asked questions/.test(about) : about.includes(r.subject));
    if (aboutIt) out.push({ requirement: r, whole: true });
    // On the deliverable, a named part is looked for under its heading; the
    // whole text stands for it only when it is the one thing asked for.
    else if (stage.id === deliverableId) out.push({ requirement: r, whole: subjects.size === 1 });
  }
  return out;
}
