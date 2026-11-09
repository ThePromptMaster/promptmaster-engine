/**
 * Chapters the model stopped writing at its length limit (8 Nov, production).
 *
 * A chapter is one call of 4,096 tokens, about 2,700 words. Eight chapters of a
 * book ended mid-sentence, one at "Tet". Later revision passes returned the same
 * cut text with a finish reason of `stop`, so nothing said so any more. Here:
 * what counts as cut, and how a continuation is joined. Pure.
 */

import type { OutlineSection } from '@/types';

/** How many times one job carries a section on before leaving it marked as cut. */
export const MAX_CONTINUE_ROUNDS = 3;
/** How much of the section the model is shown: where it stopped, not the whole chapter. */
export const CONTINUE_TAIL_CHARS = 8_000;

/** A last line that is a table, list, heading, quote, fence or rule: not a sentence that could be cut. */
const NOT_PROSE = /^(?:\||[-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|~~~|---|\*\*\*|___)/;
/** Prose only stops here when it was cut: a Latin-script letter, a digit, or punctuation that expects more. */
const OPEN_ENDING = /[\p{Script=Latin}\d,;:(\-–—]$/u;
/** Fewer words than this on the last line is a sign-off or a label, not a broken sentence. */
const MIN_WORDS = 8;

/**
 * Whether prose stops in the middle of a sentence. Conservative, and never
 * enough alone: another script's full stop, a table, a sign-off all read as
 * finished. Only ever combined with the section having been cut before.
 */
export function endsMidSentence(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  const last = t.slice(t.lastIndexOf('\n') + 1).trim();
  if (NOT_PROSE.test(last) || last.split(/\s+/).length < MIN_WORDS) return false;
  return OPEN_ENDING.test(last);
}

type Written = Pick<OutlineSection, 'status' | 'content' | 'finish_reason'>;

/** A written section that is unfinished: stopped at the limit, or once cut and still ending mid-sentence. */
export function isCutSection(section: Written, everCut = false): boolean {
  if (section.status !== 'complete' || !section.content?.trim()) return false;
  if (section.finish_reason === 'length') return true;
  return everCut && endsMidSentence(section.content);
}

/** Sections the log says were ever cut: the field alone was overwritten by later passes. */
export function everCutIds(events: readonly { type: string; payload?: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== 'section_written') continue;
    const p = (e.payload ?? {}) as { finish_reason?: unknown; section_id?: unknown };
    if (p.finish_reason === 'length' && typeof p.section_id === 'string') out.add(p.section_id);
  }
  return out;
}

/** The sections of an outline that are cut, in order. */
export function cutSections<T extends Written & { id: string }>(outline: readonly T[], events: readonly { type: string; payload?: unknown }[]): T[] {
  const ever = everCutIds(events);
  return outline.filter((s) => isCutSection(s, ever.has(s.id)));
}

const OPEN = /[\p{L}\p{N},;:(\-–—]$/u;
const BOUNDARY = /(?:[.!?…]["”’)\]*_]*\s+|\n+)/g;

/** The text up to its last complete sentence, and the unfinished sentence after it. */
export function splitUnfinished(text: string): { kept: string; unfinished: string } {
  const t = text.trimEnd();
  if (!OPEN.test(t)) return { kept: t, unfinished: '' };
  const last = [...t.matchAll(BOUNDARY)].at(-1);
  const at = last ? last.index + last[0].length : 0;
  const unfinished = t.slice(at);
  // No boundary near the end: nothing safe to replace, so keep it all and go on after it.
  if (!unfinished || unfinished.length > 2_000) return { kept: t, unfinished: '' };
  return { kept: t.slice(0, at), unfinished };
}

/**
 * The section with its continuation. The reply starts from the unfinished
 * sentence, which `kept` has left out, so a word cut in half joins cleanly.
 * A reply that started the whole section over replaces it rather than doubling it.
 */
export function joinContinuation(kept: string, continuation: string): string {
  const next = continuation.replace(/^\s+/, '');
  if (!kept.trim()) return next;
  const opening = kept.trimStart().slice(0, 80);
  if (opening.length >= 40 && next.startsWith(opening)) return next;
  if (/\s$/.test(kept)) return kept + next;
  return `${kept}\n\n${next}`;
}

/** The end of a section, as the model is shown it. */
export function continuationTail(text: string): string {
  return text.length <= CONTINUE_TAIL_CHARS ? text : text.slice(-CONTINUE_TAIL_CHARS);
}

/** How far back into the old text a carried-on rewrite is shown: the new text is rarely the same length. */
const REST_MARGIN = 4_000;

/**
 * What a rewrite cut off at the limit still owes (9 Nov, production): its brief, and
 * the old text it had not reached. Without them the continuation writes a new ending
 * of its own, and a change asked for at the end is lost. Nothing on a first draft.
 */
export function rewriteToCarryOn(
  revise: { instruction?: string; notes?: string } | undefined,
  before: string | undefined,
  kept: string
): { revision_brief?: string; rest_of_current?: string } {
  if (!revise) return {};
  const brief = [revise.instruction, revise.notes].filter(Boolean).join('\n').slice(0, 8_000);
  const rest = before ? before.slice(Math.max(0, kept.length - REST_MARGIN)).slice(-39_000) : '';
  return { ...(brief ? { revision_brief: brief } : {}), ...(rest ? { rest_of_current: rest } : {}) };
}
