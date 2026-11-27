/**
 * A linked project updated from its original is a change to what this project
 * draws on (28 Nov, Sean, Harborlight; L-326). Pure.
 *
 * "I changed the source to 18 seats per session and clicked Update from the
 * original in the dependent project. The source copy refreshed, but Answer v3
 * still showed 48 seats and Ready to move on." The update stored the new copy
 * and recorded nothing, so no stage was marked for a recheck. Now the text a
 * reference brings is compared before and after; when it says something new,
 * the change is judged against the work as a changed brief field is, and
 * recorded as a `brief_changed` the projection reads.
 */

import { presentationOnly } from './brief-change';
import type { ReferenceSnapshot } from '@/types/project';

/** How much of each side an event keeps, as a brief change does. */
const KEPT = 20_000;

/** What a reference brings to the prompts, as one text: its deliverable and, when sent, its facts. */
export function referenceText(s: ReferenceSnapshot | null | undefined, includeFacts: boolean): string {
  if (!s) return '';
  const facts = includeFacts ? (s.facts ?? []).filter((f) => f.trim()) : [];
  return [(s.text ?? '').trim(), facts.length ? `Facts:\n${facts.map((f) => `- ${f.trim()}`).join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What an update brought: the reference's text before and after, or null when
 * it brought nothing a stage could have relied on (no earlier copy, the same
 * text, or only punctuation and spacing).
 */
export function referenceChange(
  before: ReferenceSnapshot | null | undefined,
  after: ReferenceSnapshot | null | undefined,
  includeFacts: boolean
): { before: string; after: string } | null {
  const was = referenceText(before, includeFacts);
  const is = referenceText(after, includeFacts);
  if (!was || !is || was === is || presentationOnly(was, is)) return null;
  return { before: was.slice(0, KEPT), after: is.slice(0, KEPT) };
}

/** "[R1] Harborlight Workshop — capacity source": how prompts and the page name a reference. */
export function referenceName(index: number, title: string): string {
  return `[R${index + 1}] ${title.trim() || 'Untitled project'}`;
}
