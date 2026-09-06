/**
 * The bridge from an approved outline to the thing drafting actually reads.
 *
 * Two representations exist, and both have to: `artifact_versions` holds the
 * outline as an immutable, approvable document, while `artifacts.long_form`
 * holds the mutable per-section writing state that jobs advance one section at
 * a time. The version cannot hold prose (the table is append-only, and a
 * section landing every few minutes would bury real outline versions under
 * hundreds of rows); the blob cannot be approved (it changes under you).
 *
 * So an approval has to be materialised. This is that function, and it is pure:
 * the caller persists the result with `saveLongForm`.
 *
 * The merge rule is the load-bearing part. Sections already written keep their
 * content, status, revision and provenance, matched by item id. Approving a
 * newer outline must never cost a user prose that has been generated and paid
 * for — the same guarantee FR-05 makes about a closed browser, made here about
 * an edited outline.
 */

import type { LongFormState, OutlineSection } from '@/types';
import type { OutlineDocument, SectionDraftBinding } from '@/types/outline';

function blankSection(id: string, title: string, abstract: string): OutlineSection {
  return {
    id,
    title,
    abstract,
    status: 'pending',
    content: '',
    revision: 0,
    finish_reason: null,
    error: null,
    generated_at: null,
  };
}

/**
 * Project an outline document onto the drafting state.
 *
 * Order and headings come from the document — it is the approved plan. Prose
 * comes from whatever was already written. An item dropped from the outline
 * takes its prose out of the drafting list, but the document's orphan tray is
 * where that section is recoverable from, so nothing is destroyed here either.
 */
export function longFormFromOutline(
  doc: OutlineDocument,
  existing: LongFormState | null,
  now: string = new Date().toISOString()
): LongFormState {
  const written = new Map((existing?.outline ?? []).map((s) => [s.id, s]));

  const outline: OutlineSection[] = doc.items.map((item) => {
    const prior = written.get(item.id);
    if (!prior) return blankSection(item.id, item.title, item.abstract);
    // Title and abstract follow the approved outline; everything else is the
    // record of work done and is carried across untouched.
    return { ...prior, title: item.title, abstract: item.abstract };
  });

  const complete = outline.filter((s) => s.status === 'complete').length;
  const done = outline.length > 0 && complete === outline.length;

  return {
    state: done ? 'complete' : existing?.state === 'writing' ? 'writing' : 'review_outline',
    // Where the queue should pick up: the first section without prose.
    current_section_index: Math.max(
      0,
      outline.findIndex((s) => s.status !== 'complete')
    ),
    outline,
    continuity_snapshot: existing?.continuity_snapshot ?? null,
    started_at: existing?.started_at ?? now,
    completed_at: done ? (existing?.completed_at ?? now) : null,
  };
}

/**
 * Whether the drafting state already matches the outline.
 *
 * Compared on the fields an approval can change, so a poll that finds nothing
 * new does not write. Section content is excluded on purpose: prose advancing
 * is not the outline changing.
 */
export function longFormMatchesOutline(
  doc: OutlineDocument,
  existing: LongFormState | null
): boolean {
  const outline = existing?.outline ?? [];
  if (outline.length !== doc.items.length) return false;
  return doc.items.every(
    (item, i) =>
      outline[i].id === item.id &&
      outline[i].title === item.title &&
      outline[i].abstract === item.abstract
  );
}

/**
 * What the outline editor needs to know about prose: which items have words,
 * and which outline version those words were written against.
 *
 * Read per section, not per artifact. `write_long_form_section` stamps the
 * outline version onto the section it wrote, so after a re-approval some
 * sections are current and some are not — and that difference is precisely what
 * the stale-drafts notice exists to show.
 */
export function draftBindings(existing: LongFormState | null): SectionDraftBinding[] {
  return (existing?.outline ?? [])
    .filter((s) => s.content.trim().length > 0)
    .map((s) => ({
      item_id: s.id,
      outline_version_id: s.outline_version_id ?? null,
      word_count: s.content.trim().split(/\s+/).length,
    }));
}
