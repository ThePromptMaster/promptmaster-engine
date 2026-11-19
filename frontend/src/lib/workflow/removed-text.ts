/**
 * What the user took out of the work, kept so it stays out (28 Oct).
 *
 * Sean, HarborDesk test: "a sentence explicitly removed during revision
 * returned later". The instruction that removed it reached later prompts — the
 * latest twelve of them (`applied-instructions.ts`) — but the sentence itself
 * reached none, so a redraft working from the brief or the sources wrote it
 * again, and a repair that dropped it again had it put back as "removed without
 * being asked" (`preservation.ts`). Every request now carries the sentences
 * (`PMInput.removed_text`), and preservation never restores one. Pure.
 *
 * A sentence counts as removed by the user when it was in a stage's version
 * and is gone from the next one, and that next version is the user's own edit,
 * or was made from an instruction that asks for something to go. A sentence
 * reworded rather than removed (most of its words still in one sentence) is
 * not counted. The user's own later version that has the sentence again takes
 * it off the list: they brought it back.
 */

import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

/** Versions the user made: a direct edit, or an instruction they wrote and applied. */
const USER_MADE: ReadonlySet<string> = new Set(['stage_edit', 'chat_instruct', 'chat_save']);

/**
 * An instruction that asks for text to go. Narrower than preservation's
 * `asksForRemovals`: "shorten it" or "rewrite it" lets a revision drop lines,
 * but does not mean each dropped line must never come back.
 */
const ASKS_TO_REMOVE =
  /\b(remov\w*|delet\w*|drop\w*|cut\w*|omit\w*|strik\w*|take (?:[\w'-]+ ){0,4}out|get rid of|leave (?:[\w'-]+ ){0,4}out|no longer (?:mention|include|say|state)\w*|don'?t (?:mention|include|say)|do not (?:mention|include|say)|lose)\b/i;

const MIN_WORDS = 4;
const EACH_MAX = 400;
const MAX = 30;

export interface RemovedText {
  /** The stage it was removed from, as the user sees it. */
  stage: string;
  stageId: string;
  sentence: string;
  at: string;
  /** The version it went in: what a prompt saying the user removed it cites (19 Nov). */
  version?: number;
}

/** A sentence reduced to its words, for comparing. */
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The work's sentences: each line, without its list or heading marker, split at sentence ends. */
export function sentencesOf(text: string): string[] {
  if (/^\s*[{[]/.test(text) && /[}\]]\s*$/.test(text)) return [];
  return text
    .split('\n')
    .flatMap((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '').split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\p{N}])/u))
    .map((s) => s.trim())
    .filter((s) => !/^\|/.test(s) && key(s).split(' ').length >= MIN_WORDS);
}

/** The sentences of `before` that `after` no longer has, removed rather than reworded. */
export function sentencesRemoved(before: string, after: string): string[] {
  const now = sentencesOf(after).map(key);
  const exact = new Set(now);
  const sets = now.map((k) => new Set(k.split(' ')));
  return sentencesOf(before).filter((s) => {
    const k = key(s);
    if (exact.has(k)) return false;
    const w = k.split(' ');
    return !sets.some((set) => w.filter((x) => set.has(x)).length / w.length >= 0.75);
  });
}

/**
 * The user's own words in an instruction: what they quote from someone else is
 * taken out (19 Nov, Sean, Inventory Selection). He passed on a vendor's message
 * asking to "remove historical transactions from the export requirement", and said
 * he had changed nothing; the rewrite dropped about fifty sentences, and every one
 * was filed as removed by him, so Go later stopped over "a sentence you removed".
 */
export function ownWords(instruction: string): string {
  return instruction.replace(/“[^”]*”?|"[^"\n]*"|‘[^’]*’|«[^»]*»/g, ' ');
}

/** The asking words themselves, stemmed: never what is asked to go. */
const REMOVE_VERBS = /^(?:remov|delet|drop|dropp|cut|omit|strik|take|rid|leave|lose|longer|mention|include|say)/;

const TARGET_STOP = new Set(['this', 'that', 'these', 'those', 'from', 'with', 'into', 'about', 'every', 'there', 'their', 'please', 'sentence', 'sentences', 'line', 'lines', 'paragraph', 'section', 'text', 'part', 'mention', 'mentions']);

/** The words an instruction asks to have go: those in and after each "remove", "cut", "leave out", to the end of its clause. */
function removalTargets(own: string): Set<string> {
  const out = new Set<string>();
  for (const m of own.matchAll(new RegExp(ASKS_TO_REMOVE.source, 'gi'))) {
    // What follows the asking words, to the end of its clause: "remove the export claim", not "and say …".
    const after = own.slice((m.index ?? 0) + m[0].length).split(/[.;:,\n]|\b(?:and|then|but|so)\b/i)[0].split(/\s+/).slice(0, 12).join(' ');
    for (const x of stemmed(`${m[0]} ${after}`)) if (!TARGET_STOP.has(x) && !REMOVE_VERBS.test(x)) out.add(x);
  }
  return out;
}

/**
 * Whether a version's dropped sentence was removed by the user. Their own edit
 * removes on purpose. A version made from their instruction removes only what the
 * instruction, in their own words, asks to go: a rewrite's other dropped lines are
 * not theirs (19 Nov).
 */
function removedOnPurpose(v: { source_operation: string; instruction?: string | null }): ((sentence: string) => boolean) | null {
  if (v.source_operation === 'stage_edit') return () => true;
  if (!USER_MADE.has(v.source_operation)) return null;
  const own = ownWords(v.instruction ?? '');
  if (!ASKS_TO_REMOVE.test(own)) return null;
  const targets = removalTargets(own);
  return (sentence) => stemmed(sentence).some((w) => targets.has(w));
}

/** Every sentence the user removed and has not brought back, oldest first, the latest `MAX`. */
export function removedByUser(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): RemovedText[] {
  if (!bundles) return [];
  const out = new Map<string, RemovedText>();
  for (const stage of template.stages) {
    const versions = [...(bundles[stage.id]?.versions ?? [])].sort((a, b) => a.version_number - b.version_number);
    for (let i = 1; i < versions.length; i++) {
      const v = versions[i];
      if (!USER_MADE.has(v.source_operation)) continue;
      // Their own version that has it again: they brought it back.
      for (const s of sentencesOf(v.content)) {
        const k = key(s);
        if (out.get(k)?.stageId === stage.id) out.delete(k);
      }
      const onPurpose = removedOnPurpose(v);
      if (!onPurpose) continue;
      for (const s of sentencesRemoved(versions[i - 1].content, v.content)) {
        if (!onPurpose(s)) continue;
        const sentence = s.length > EACH_MAX ? `${s.slice(0, EACH_MAX - 1).trimEnd()}…` : s;
        out.set(key(s), { stage: stage.label, stageId: stage.id, sentence, at: v.created_at, ...(v.version_number ? { version: v.version_number } : {}) });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX);
}

/**
 * A `keep` test for preservation: a line that holds a sentence the user
 * removed is never put back, however the revision came to drop it.
 */
export function notRemovedByUser(removed: readonly { sentence: string }[] | undefined): (line: string) => boolean {
  const keys = (removed ?? []).map((r) => key(r.sentence.replace(/…$/, ''))).filter(Boolean);
  if (!keys.length) return () => true;
  return (line) => {
    const k = key(line);
    return !keys.some((r) => k.includes(r));
  };
}

/** The words of a sentence worth comparing: four letters or more. */
const content = (s: string) => key(s).split(' ').filter((w) => w.length > 3);

/** Nearly the same sentence: the same words either way round, give or take one in ten. */
function same(a: string, b: string): boolean {
  if (key(a) === key(b)) return true;
  const wa = content(a);
  const wb = content(b);
  if (wa.length < 3 || wb.length < 3) return false;
  const sb = new Set(wb);
  const sa = new Set(wa);
  return wa.filter((w) => sb.has(w)).length / wa.length >= 0.9 && wb.filter((w) => sa.has(w)).length / wb.length >= 0.9;
}

const stemmed = (s: string) => content(s).map((w) => w.replace(/(?:ing|ed|es|s)$/, ''));

/**
 * The user's instruction is about this sentence ("put the refund line back",
 * "add a sentence saying refunds take 24 hours"): their newer word, so it is
 * not taken out. Only a user's own instruction is passed here — never Go's or
 * a redraft's, which would quote the brief that asked for it in the first place.
 */
function askedBack(instruction: string, sentence: string): boolean {
  const asked = new Set(stemmed(instruction));
  const w = stemmed(sentence);
  return w.filter((x) => asked.has(x)).length >= Math.min(2, w.length);
}

/**
 * The text with every sentence the user removed taken out again (28 Oct):
 * whatever wrote it — a redraft, Go, a chapter — the user's removal stands
 * unless the instruction it was made from asks for that sentence back. A line
 * left empty goes; the rest of a line keeps its marker and its other sentences.
 */
export function withoutRemoved(
  text: string,
  removed: readonly { sentence: string }[] | undefined,
  instruction = ''
): { text: string; dropped: string[] } {
  const gone = (removed ?? []).map((r) => r.sentence.replace(/…$/, '')).filter((s) => s.trim() && !askedBack(instruction, s));
  if (!gone.length || !text.trim() || (/^\s*[{[]/.test(text) && /[}\]]\s*$/.test(text))) return { text, dropped: [] };
  const dropped: string[] = [];
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line) || /^\s*#{1,6}\s/.test(line)) {
      lines.push(line);
      continue;
    }
    const marker = line.match(/^\s*(?:[-*+]|\d+[.)]|>)\s+/)?.[0] ?? '';
    const parts = line.slice(marker.length).split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\p{N}])/u);
    const kept = parts.filter((p) => {
      const hit = gone.find((g) => same(p, g));
      if (hit) dropped.push(p.trim());
      return !hit;
    });
    if (kept.length === parts.length) lines.push(line);
    else if (kept.join(' ').trim()) lines.push(marker + kept.join(' '));
  }
  return dropped.length ? { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), dropped } : { text, dropped };
}
