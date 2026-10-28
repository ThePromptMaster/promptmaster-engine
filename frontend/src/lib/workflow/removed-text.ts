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

function removesOnPurpose(v: { source_operation: string; instruction?: string | null }): boolean {
  if (v.source_operation === 'stage_edit') return true;
  return USER_MADE.has(v.source_operation) && ASKS_TO_REMOVE.test(v.instruction ?? '');
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
      if (!removesOnPurpose(v)) continue;
      for (const s of sentencesRemoved(versions[i - 1].content, v.content)) {
        const sentence = s.length > EACH_MAX ? `${s.slice(0, EACH_MAX - 1).trimEnd()}…` : s;
        out.set(key(s), { stage: stage.label, stageId: stage.id, sentence, at: v.created_at });
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

/** An instruction that asks for this sentence back ("put the refund line back"). */
const stemmed = (s: string) => content(s).map((w) => w.replace(/(?:ing|ed|es|s)$/, ''));

function askedBack(instruction: string, sentence: string): boolean {
  if (!/\b(back|restore\w*|reinstat\w*|re-?add\w*|again)\b/i.test(instruction)) return false;
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
