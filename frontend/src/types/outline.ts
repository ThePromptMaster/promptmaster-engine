/**
 * The outline domain (FR-07).
 *
 * An outline is a versioned, approvable list of sections. It is stored as JSON
 * in ArtifactVersion.content rather than in a table of its own, so that outline
 * history IS version history — restore, provenance and the immutability trigger
 * apply to an outline without a line of extra code.
 *
 * Item ids are the lineage. They are minted once and carried forward through
 * every edit, fork and regeneration, which is what lets a drafted section find
 * its outline item again after the outline has been reordered, re-approved or
 * regenerated underneath it.
 */

export interface OutlineItem {
  /** Stable across versions. Never re-minted for an item that already exists. */
  id: string;
  title: string;
  abstract: string;
}

/**
 * A section that left the outline while its prose was kept.
 *
 * Written work is never destroyed as a side effect of an outline edit. Removing
 * a drafted section, or regenerating the whole outline over one, moves it here
 * where the user can reattach it or discard it deliberately.
 */
export interface OrphanedSection {
  item_id: string;
  title: string;
  abstract: string;
  reason: 'removed' | 'regenerated';
  orphaned_at: string;
}

export interface OutlineDocument {
  schema: 1;
  items: OutlineItem[];
  orphans: OrphanedSection[];
  /**
   * Set on a draft cloned from an approved version. Records what this draft is
   * a copy of, so the fork is visible in the UI and survives into the
   * committed version's provenance.
   */
  forked_from_version_id?: string | null;
}

/**
 * What a drafted section remembers about the outline it was written against.
 *
 * Supplied by the drafting surface, not owned by the outline editor. The editor
 * only needs to know which prose exists and which outline version it belongs
 * to, so that removing an item can offer to keep it and a newer approval can
 * say "3 sections were written against outline v1" rather than silently
 * invalidating them.
 */
export interface SectionDraftBinding {
  item_id: string;
  /** The outline version id this prose was written against; null if unknown. */
  outline_version_id: string | null;
  word_count: number;
}
