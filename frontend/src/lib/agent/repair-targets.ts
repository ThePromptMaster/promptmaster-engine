/**
 * Which sections a manuscript repair rewrites (17 Nov). Pure.
 *
 * Sean's book: a chapter was retitled, and the chapter plan's repair had
 * already put the new title in the chapters. The reopened manuscript was then
 * "repaired" by rewriting every one of its 26 sections, twelve times over, for
 * about $63, and the text did not change. A repair now looks first:
 * - the sections that still state an old value are found in code;
 * - one small call (`agent/sections-to-repair`) reads an excerpt of each
 *   section and names the ones the reason concerns, or says the change is
 *   already made;
 * - only those sections are rewritten.
 */

import type { OutlineSection } from '@/types';
import { leftoverMentions, namedLeftovers, type SupersededValue } from '@/lib/workflow/fact-values';

/** What a reason says changed: quoted phrases, the replaced values, and the chapters it names. */
export function changeTerms(why: string, superseded: readonly Pick<SupersededValue, 'was' | 'now' | 'value'>[]): string[] {
  const terms = new Set<string>();
  // Double quotes, curly quotes, and single quotes that open after a space: an
  // apostrophe ("manuscript's") never starts a phrase.
  for (const m of why.matchAll(/"([^"\n]{3,120})"|“([^”\n]{3,120})”|‘([^’\n]{3,120})’|(?:^|[\s(])'([^'\n]{3,120})'(?=[\s.,;:!?)]|$)/g)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (phrase) terms.add(phrase);
  }
  for (const m of why.matchAll(/\b(?:chapter|section|part)\s+(?:\d+|[ivxlc]+)\b/gi)) terms.add(m[0]);
  for (const v of superseded) {
    for (const t of [v.value, v.was, v.now]) {
      const s = (t ?? '').trim();
      if (s.length >= 2 && s.length <= 120) terms.add(s);
    }
  }
  return [...terms].filter((t) => t.trim().length >= 2);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A section as the target check sees it: its opening, and every sentence that
 * mentions one of the terms, up to `max` characters.
 */
export function sectionExcerpt(content: string, terms: readonly string[], max = 1_500): string {
  const text = content.replace(/\r/g, '').trim();
  if (!text) return '';
  const opening = text.slice(0, 300).replace(/\s+/g, ' ').trim();
  const pattern = terms.length ? new RegExp(terms.map(escape).join('|'), 'i') : null;
  const hits: string[] = [];
  if (pattern) {
    const sentences = text.split(/(?<=[.!?])\s+|\n+/);
    for (const s of sentences) {
      const flat = s.replace(/\s+/g, ' ').trim();
      if (flat && pattern.test(flat) && !opening.includes(flat)) hits.push(flat.slice(0, 400));
    }
  }
  let out = `Opening: ${opening}${text.length > 300 ? '…' : ''}`;
  if (hits.length) out += `\nMentions: ${hits.join(' … ')}`;
  else if (pattern) out += '\nMentions: none of what changed.';
  return out.slice(0, max);
}

/** The written sections that still state a value the project replaced, found in code. */
export function sectionsWithOldValues(outline: readonly OutlineSection[], superseded: readonly SupersededValue[]): string[] {
  if (!superseded.length) return [];
  const whole = outline.map((s) => s.content ?? '').join('\n\n');
  return outline
    .filter((s) => s.status === 'complete' && namedLeftovers(leftoverMentions(s.content ?? '', superseded, { derivedIn: whole })).length > 0)
    .map((s) => s.id);
}

/**
 * How long Go waits for a repair's sections: ten minutes, and two and a half
 * more for each section, at most an hour and a half. A whole book took about
 * an hour on production, and a ten-minute wait cut every pass short (15 Nov).
 */
export function repairWaitMs(sections: number): number {
  return Math.min(90, 10 + 2.5 * Math.max(0, sections)) * 60_000;
}
