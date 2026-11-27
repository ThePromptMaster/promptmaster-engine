/**
 * What holds an email back after it was written (Sean, 26 Nov: when a client update moves a
 * milestone, an email that still states the old one must not go out). Pure: the Drafts stage, the
 * change watcher and the job runner (`lib/jobs/outreach-store.ts`) all use it, so the page and the
 * server hold for the same reasons.
 */
import { leftoverValues } from '@/lib/workflow/fact-values';
import { supersededFactValues } from '@/lib/workflow/facts';
import type { ProjectFact } from '@/types/project';

/** 'It still states what "Go-live is on 14 March" said, since replaced by "Go-live moved to 21 March".' Null when nothing replaced is stated. */
export function replacedIn(text: string, facts: readonly ProjectFact[] | undefined): string | null {
  if (!facts?.length || !text.trim()) return null;
  const left = leftoverValues(text, supersededFactValues(facts));
  if (!left.length) return null;
  const v = left[0];
  const clean = (t: string) => t.trim().replace(/[.\s]+$/, '');
  return `It still states what "${clean(v.was)}" said, since replaced by "${clean(v.now)}".`;
}
