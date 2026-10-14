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

export type MeasureKind = 'words' | 'questions' | 'sections' | 'pages';

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
  /** What was counted, met or not: "187 words" (11 Oct: the check is told the count, not only failures). */
  value?: string;
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
  // "a 120–180-word announcement": after it. "the announcement must be
  // 100–140 words", "a launch announcement (100-140 words) and a … FAQ":
  // before it. Whichever is nearer — on production the second form was read
  // as the FAQ's (9 Oct).
  const afterText = text.slice(end, end + 40);
  const after = afterText.match(SUBJECT_RE);
  const beforeText = text.slice(Math.max(0, start - 60), start);
  const all = [...beforeText.matchAll(new RegExp(SUBJECT_RE.source, 'gi'))];
  const before = all.at(-1);
  const afterGap = after ? after.index! : Infinity;
  const beforeGap = before ? beforeText.length - (before.index! + before[0].length) : Infinity;
  if (afterGap === Infinity && beforeGap === Infinity) return '';
  return canonical(afterGap <= beforeGap ? after![1] : before![1]);
}

const canonical = (s: string) => (/frequently asked questions/i.test(s) ? 'faq' : s.toLowerCase());

/** Words that make the words before a limit a sentence, not the name of a part. */
const NOT_A_NAME = /^(?:a|an|the|it|this|that|them|each|every|keep|write|make|be|is|are|must|should|shall|will|stay|stays|remain|and|or|with|of|in|to|for|its|their|your|our|than|at|no|not|only|all|any|total)$/i;

/**
 * The part a limit is written straight after: "exactly three sections:
 * executive update capped at 120 words". 13 Oct (Sean, Harbor/PINE): the
 * part was not one of `SUBJECTS`, so the limit was read as the whole pack's
 * and the 98-word update measured 150 words with the tracker and log.
 * Only a short noun phrase opening its own clause counts; anything with a
 * verb or an article in it falls back to `subjectNear`.
 */
function partBefore(text: string, start: number): string {
  const before = text.slice(Math.max(0, start - 80), start);
  // "Section 1 (executive update) must be…", "Section 2, the tracker, is…",
  // "Section 1 is limited to…": the section it names, by name when one is
  // given, else by number.
  const numbered = before.match(new RegExp(`\\bsection\\s+${NUM}\\b\\s*(?:\\(([^)]{2,40})\\)|[,:—–-]\\s*(?:the\\s+)?([a-z][a-z -]{1,40}?)\\s*[,—–-])?[^.;\\n]*$`, 'i'));
  if (numbered) {
    const name = (numbered[2] ?? numbered[3] ?? '').trim().toLowerCase();
    return name || `section ${num(numbered[1])}`;
  }
  const clause = before.split(/[:;,(.\n]|\band\b/).at(-1) ?? '';
  // 14 Oct (Sean, ASPEN): "Executive update must be no more than 100 words"
  // was read as the whole pack's, because "must be" stopped the phrase being
  // a name. The verb is dropped from the end, and "the" from the front.
  const words = clause.trim().replace(/[)\]]+/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length && TRAILING_VERB.test(words.at(-1)!)) words.pop();
  // Only "the": "a survey kickoff brief under 30 words" is the deliverable
  // itself, as it was before (e2e objective-pause), not a part of it.
  if (words.length && /^the$/i.test(words[0])) words.shift();
  if (!words.length || words.length > 3) return '';
  if (words.some((w) => NOT_A_NAME.test(w) || !/^[a-z][a-z-]*$/i.test(w))) return '';
  const phrase = words.join(' ').toLowerCase();
  if (WHOLE.test(phrase)) return '';
  // "executive summary" is the summary every other check already knows.
  const listed = phrase.match(SUBJECT_RE);
  if (listed) return canonical(listed[1]);
  // "chapters capped at 3,000 words" names each one, not a part: singular.
  return phrase.replace(/(?<!s)s$/, '');
}

/** Words between a part's name and its limit: "must be", "is", "should stay". */
const TRAILING_VERB = /^(?:is|are|be|must|should|shall|will|stays?|remains?|kept|runs?|needs?|to|has|have)$/i;

/** Names for the whole deliverable, not a part of it. */
const WHOLE = /^(?:deliverable|document|output|response|pack|whole(?: thing)?|text|draft|piece|it)$/i;

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
      // 11 Oct (survey brief): "capped at 200 words" was not read, so the limit
      // was never measured and the model's eye count stood unchallenged.
      [new RegExp(`\\b(?:under|fewer than|less than|at most|no more than|not more than|no longer than|maximum of|a maximum of|max(?:imum)?|up to|below|within|capped at|a cap of|limited to|a limit of|not (?:to )?exceed(?:ing)?)\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ max: num(m[1]) })],
      // 12 Oct (Sean, Diligence): "a 250-word executive summary", "≤ 250
      // words" and "keep it to 250 words" were not read, so the model's eye
      // count stood and an overlength summary passed.
      [new RegExp(`(?:≤|<=|<)\\s*${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ max: num(m[1]) })],
      [new RegExp(`\\bkeep (?:it|this|them|the [a-z ]{1,30}?) (?:to|under|within|below)\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ max: num(m[1]) })],
      [new RegExp(`\\b${NUM}-words?\\s+(?:(?:executive|short|brief|one-paragraph|opening|closing)\\s+)?(?=(?:${SUBJECTS.join('|')}|frequently asked questions)\\b)`, 'gi'), (m) => ({ max: num(m[1]) })],
      // "200 words max", "200 words or fewer", "a 200-word limit".
      [new RegExp(`\\b${NUM}[\\s-]*words?\\s+(?:max(?:imum)?|or (?:less|fewer)|at most|limit|cap)\\b`, 'gi'), (m) => ({ max: num(m[1]) })],
      [new RegExp(`\\b(?:at least|a minimum of|minimum of|no fewer than|no less than)\\s+${NUM}[\\s-]*words?\\b`, 'gi'), (m) => ({ min: num(m[1]) })],
    ];
    for (const [re, read] of patterns) {
      for (const m of t.matchAll(re)) {
        const r = read(m);
        if ((r.min ?? 0) > 20_000 || (r.max ?? 0) > 20_000) continue;
        // "Keep the summary to 250 words" names its subject inside the match.
        const inside = m[0].match(SUBJECT_RE);
        const subject = inside ? canonical(inside[1]) : partBefore(t, m.index!) || subjectNear(t, m.index!, m.index! + m[0].length);
        add({ kind: 'words', subject, source: m[0].trim(), ...r });
      }
    }
    // "a one-page plan", "fits on one page", "no more than two pages" (L-73,
    // 11 Oct: Sean's onboarding plan was declared finished with its one-page
    // requirement never checked). Pages are estimated from the word count.
    const pagePatterns: [RegExp, (m: RegExpMatchArray) => number][] = [
      [/\b(one|single)[\s-]page\b/gi, () => 1],
      [new RegExp(`\\b(?:fits? on|on|within|under|at most|no more than|not more than|no longer than|maximum of|max(?:imum)?|up to)\\s+(?:a\\s+)?${NUM}\\s+pages?\\b`, 'gi'), (m) => num(m[1])],
      [new RegExp(`\\b${NUM}[\\s-]+pages?\\s+(?:max(?:imum)?|or (?:less|fewer)|at most|limit)\\b`, 'gi'), (m) => num(m[1])],
    ];
    for (const [re, read] of pagePatterns) {
      for (const m of t.matchAll(re)) {
        const n = read(m);
        if (!n || n > 50) continue;
        add({ kind: 'pages', subject: subjectNear(t, m.index!, m.index! + m[0].length), max: n, source: m[0].trim() });
      }
    }
    // "exactly four sections", "with four sections" (11 Oct, survey brief).
    // Only after a word that makes it a requirement: "the four sections
    // below" measures nothing.
    for (const m of t.matchAll(new RegExp(`\\b(?:exactly|with|in|into|has|have|of)\\s+(?:exactly\\s+)?${NUM}\\s+(?:main\\s+|top-level\\s+)?sections?\\b`, 'gi'))) {
      const n = num(m[1]);
      if (!n || n > 30) continue;
      add({ kind: 'sections', subject: '', min: n, max: n, source: m[0].trim() });
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
/**
 * Lines a count leaves out: notes about the text rather than the text.
 * Assumptions are not among them (11 Oct, survey brief): a brief asked to
 * label its assumptions holds them as part of what it says, so "Assumption:
 * the survey runs online" counts — as it does when anyone counts the brief.
 */
const NOTE = /^\W*(what changed|revision notes?|change notes?|notes?|word count|words?\s*:|\(\d+\s+words?\)|verification)\b/i;

/**
 * A part of a document that sits beside other parts — "a summary of at most
 * 100 words, followed by a five-row table and three questions" — rather than
 * being the whole of it.
 */
const PART_SUBJECTS: ReadonlySet<string> = new Set(['summary', 'abstract', 'overview', 'introduction']);

/** Lines that are never part of a summary's prose: a table row, a numbered or labelled question. */
const isTableLine = (l: Line) => l.level === 0 && /^\|.*\|$/.test(l.text);
const isListedQuestion = (l: Line) => l.level === 0 && /^(?:\d+[.)]|q\s*\d+[.:)]?|question\s*\d+[.:)]?)\s+/i.test(l.text) && isQuestion(l);

/**
 * The part of `text` that is about `subject`: under a heading naming it, or
 * null when no heading does.
 *
 * 12 Oct (Sean, Cedar): an 80-word summary measured 212, because a bold
 * "Table" label and the questions under "## Summary" did not end it. The
 * section now ends at the next heading at its level or above, at a bold or
 * "Label:" line under a markdown heading, at a heading naming another part,
 * at a table, or at a numbered question. A document's title that names the
 * subject ("# Cedar Summary", with the parts below it) is not the section.
 */
export function sectionFor(text: string, subject: string): string | null {
  if (!subject) return text;
  const all = lines(text);
  const range = sectionRange(all, subject);
  if (!range) return null;
  return all.slice(range.start + 1, range.end).map((l) => (l.level > 0 ? `# ${l.text}` : l.text)).join('\n');
}

/** The lines of `subject`'s section: its heading at `start`, its body up to `end`. */
function sectionRange(all: Line[], subject: string): { start: number; end: number } | null {
  const numbered = subject.match(/^section (\d+)$/);
  if (numbered) return nthSection(all, Number(numbered[1]));
  const named = (l: Line) => {
    const t = l.text.toLowerCase();
    return subject === 'faq' ? /\bfaq\b|frequently asked questions/.test(t) : t.includes(subject);
  };
  const heads = all.map((l, i) => ({ l, i })).filter(({ l }) => l.level > 0 && !isQuestion(l));
  const isTitle = (i: number) => {
    const first = heads[0];
    if (!first || first.i !== i || first.l.level > 6) return false;
    const rest = heads.slice(1);
    return rest.length > 0 && rest.every(({ l }) => l.level > first.l.level);
  };
  const found = heads.find(({ l, i }) => named(l) && !isTitle(i));
  if (!found) return null;
  const start = found.i;
  const level = all[start].level;
  for (let i = start + 1; i < all.length; i += 1) {
    const l = all[i];
    if (isTableLine(l) || (subject !== 'faq' && isListedQuestion(l))) return { start, end: i };
    if (l.level > 0 && !isQuestion(l)) {
      const ends = l.level <= level || (level <= 6 && l.level >= 7) || SUBJECT_RE.test(l.text) || NOTE.test(l.text) || !named(l) && PART_SUBJECTS.has(subject) && /\b(table|questions?|appendix|actions?|risks?|recommendations?|findings?|sources?)\b/i.test(l.text);
      if (ends) return { start, end: i };
    }
  }
  return { start, end: all.length };
}

/**
 * `target` with `subject`'s section replaced by the same section of `source`,
 * every other line exactly as it was; null when either has no such section.
 * A repair of one part's length changes that part and nothing else, in code
 * (14 Oct, ASPEN: Go shortened the tracker and the log to fit the update's limit).
 */
export function replaceSection(target: string, source: string, subject: string): string | null {
  const t = target.split('\n');
  const s = source.split('\n');
  const tr = sectionRange(lines(target), subject);
  const sr = sectionRange(lines(source), subject);
  if (!tr || !sr) return null;
  const body = s.slice(sr.start + 1, sr.end);
  // The blank lines that separated it from the next section stay as they were.
  while (body.length && !body.at(-1)!.trim()) body.pop();
  const trailing: string[] = [];
  for (let i = tr.end - 1; i > tr.start && !t[i].trim(); i -= 1) trailing.push('');
  return [...t.slice(0, tr.start + 1), ...body, ...trailing, ...t.slice(tr.end)].join('\n');
}

/**
 * The Nth section of a text: the Nth heading at its top level (a lone title
 * above them is not a section), up to the next heading at that level or above.
 */
function nthSection(all: Line[], n: number): { start: number; end: number } | null {
  const heads = all.map((l, i) => ({ l, i })).filter(({ l }) => l.level > 0 && l.level <= 7 && !isQuestion(l) && !NOTE.test(l.text));
  if (!heads.length) return null;
  let top = Math.min(...heads.map((h) => h.l.level));
  if (heads.filter((h) => h.l.level === top).length === 1 && heads.length > 1) top = Math.min(...heads.filter((h) => h.l.level > top).map((h) => h.l.level));
  const found = heads.filter((h) => h.l.level === top)[n - 1];
  if (!found) return null;
  const next = all.findIndex((l, i) => i > found.i && l.level > 0 && l.level <= top && !isQuestion(l));
  return { start: found.i, end: next < 0 ? all.length : next };
}

/**
 * The opening prose of a text: everything before its first heading below a
 * title, its first table or its first numbered question. Where a part such as
 * the summary has no heading of its own, this is where it is.
 */
export function openingProse(text: string): string {
  const all = lines(text);
  const out: string[] = [];
  let seenProse = false;
  for (const l of all) {
    if (isTableLine(l) || isListedQuestion(l)) break;
    if (l.level > 0 && !isQuestion(l)) {
      if (seenProse) break;
      continue; // a title, or the document's first heading
    }
    if (l.text) seenProse = true;
    out.push(l.text);
  }
  return out.join('\n');
}

/** Whether a text has parts besides its opening: a heading after prose, a table, or numbered questions. */
function hasOtherParts(text: string): boolean {
  return openingProse(text).trim().length < text.trim().length - 40;
}

/** "from “first words” to “last words”": which text a count was made of. */
export function quoteSpan(text: string): string {
  const words = lines(text).filter((l) => l.level === 0 && !NOTE.test(l.text)).map((l) => plain(l.text)).join(' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length <= 12) return `“${words.join(' ')}”`;
  return `from “${words.slice(0, 5).join(' ')}” to “${words.slice(-5).join(' ')}”`;
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

/**
 * The sections of a text: its headings at the top level of its structure. A
 * lone title above them (one heading at the shallowest level, the rest
 * deeper) is not a section.
 */
export function countSections(text: string): number {
  const heads = lines(text).filter((l) => l.level > 0 && l.level <= 7 && !isQuestion(l) && !NOTE.test(l.text));
  if (!heads.length) return 0;
  const top = Math.min(...heads.map((h) => h.level));
  const atTop = heads.filter((h) => h.level === top);
  if (atTop.length === 1 && heads.length > 1) {
    const rest = heads.filter((h) => h.level > top);
    const next = Math.min(...rest.map((h) => h.level));
    return rest.filter((h) => h.level === next).length;
  }
  return atTop.length;
}

/**
 * Words a printed page holds, for estimating pages: single-spaced, 11–12 pt,
 * with headings and short lists. Generous on purpose — an estimate that blocks
 * finishing should not do so on a page that would fit.
 */
export const WORDS_PER_PAGE = 550;

/** How a count is made, said wherever a count is shown or asked for (11 Oct). */
export const COUNTING_RULE = 'words of the text itself, not counting headings or a word-count note; labelled assumptions count';

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

/** A limit on one part of the deliverable, never on the whole of it. */
export const isPart = (r: Pick<MeasurableRequirement, 'subject'>) => Boolean(r.subject) && !SUBJECTS.includes(r.subject) && r.subject !== 'frequently asked questions';

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
  const headed = sectionFor(text, r.subject);
  // A part with no heading of its own is the opening prose, never the whole
  // document with its tables and questions (12 Oct, Cedar: 80 words read as 212).
  const opening = headed === null && whole && PART_SUBJECTS.has(r.subject) && hasOtherParts(text) ? openingProse(text) : null;
  const section = headed ?? opening ?? (whole ? text : null);
  if (section === null) return null;
  const name = subjectLabel(r.subject);
  if (r.kind === 'words') {
    const n = countWords(section);
    const ok = (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
    // The count says which text it was made of, so a wrong section shows (12 Oct).
    const span = r.subject && section !== text ? quoteSpan(section) : '';
    const value = `${n} words${span ? `, counted ${span}` : ''}`;
    return { id: `measured.${r.id}`, label: `${name}: ${rangeText(r)} words`, satisfied: ok, value, ...(ok ? {} : { detail: `${n} words` }) };
  }
  if (r.kind === 'pages') {
    // An estimate, said as one: a printed page depends on fonts and margins,
    // which the text does not fix (L-73).
    const n = countWords(section);
    const pages = Math.max(0.1, Math.round((n / WORDS_PER_PAGE) * 10) / 10);
    const ok = r.max === undefined || n <= r.max * WORDS_PER_PAGE;
    const value = `about ${pages} page${pages === 1 ? '' : 's'} (${n} words; estimated at ${WORDS_PER_PAGE} words a page)`;
    return { id: `measured.${r.id}`, label: `${name}: ${rangeText(r)} page${r.max === 1 ? '' : 's'} (estimated)`, satisfied: ok, value, ...(ok ? {} : { detail: value }) };
  }
  if (r.kind === 'sections') {
    const n = countSections(section);
    const ok = (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
    const value = `${n} section${n === 1 ? '' : 's'}`;
    return { id: `measured.${r.id}`, label: `${name}: ${rangeText(r)} sections`, satisfied: ok, value, ...(ok ? {} : { detail: value }) };
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
    value: `${total} question${total === 1 ? '' : 's'}, ${answered} answered`,
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
    // A part of it ("executive update", "section 1") is only ever that part:
    // with no heading for it, nothing is measured (14 Oct, ASPEN: 171 words
    // of a three-section pack were held to the update's 100).
    else if (stage.id === deliverableId) out.push({ requirement: r, whole: subjects.size === 1 && !isPart(r) });
  }
  return out;
}
