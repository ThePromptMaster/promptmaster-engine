/**
 * Outline document algebra: pure functions, no I/O, no React.
 *
 * Every verb FR-07 names — edit, reorder, insert, remove, regenerate, version,
 * approve — reduces to a function here that takes a document and returns a new
 * one. The component does presentation and persistence; nothing in this file
 * knows either exists, which is what makes the rules testable without a DOM
 * and without a database.
 */

import type {
  OrphanedSection,
  OutlineDocument,
  OutlineItem,
  SectionDraftBinding,
} from '@/types/outline';
import type { ArtifactVersion } from '@/types/project';

export function newItemId(): string {
  // crypto.randomUUID is available in every browser we support and in jsdom;
  // the fallback keeps this usable from a plain Node test runner.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `it-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDocument(): OutlineDocument {
  return { schema: 1, items: [], orphans: [] };
}

export function newItem(partial: Partial<OutlineItem> = {}): OutlineItem {
  return { id: partial.id ?? newItemId(), title: partial.title ?? '', abstract: partial.abstract ?? '' };
}

// --- serialisation ----------------------------------------------------------

/**
 * Parse a version's content into a document.
 *
 * Defensive in the same way the backend's JSON generators are: the container is
 * guarded with a type check, malformed rows are SKIPPED rather than fatal, and
 * missing ids are backfilled. An outline that lost one bad row is recoverable;
 * an outline stage that throws on render is not, and the content here can come
 * from a model as easily as from the editor.
 */
export function parseOutlineDocument(content: string | null | undefined): OutlineDocument {
  if (!content || !content.trim()) return emptyDocument();

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return emptyDocument();
  }
  return coerceOutlineDocument(raw);
}

export function coerceOutlineDocument(raw: unknown): OutlineDocument {
  // A bare array is accepted too: it is what a generator most naturally emits,
  // and rejecting it would mean losing a real outline over a wrapper object.
  const container = Array.isArray(raw) ? { items: raw } : raw;
  if (!container || typeof container !== 'object') return emptyDocument();

  const record = container as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const rawOrphans = Array.isArray(record.orphans) ? record.orphans : [];

  const items: OutlineItem[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : '';
    const abstract = typeof r.abstract === 'string' ? r.abstract : '';
    if (!title && !abstract) continue;
    items.push({ id: typeof r.id === 'string' && r.id ? r.id : newItemId(), title, abstract });
  }

  const orphans: OrphanedSection[] = [];
  for (const row of rawOrphans) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.item_id !== 'string' || !r.item_id) continue;
    orphans.push({
      item_id: r.item_id,
      title: typeof r.title === 'string' ? r.title : '',
      abstract: typeof r.abstract === 'string' ? r.abstract : '',
      reason: r.reason === 'regenerated' ? 'regenerated' : 'removed',
      orphaned_at: typeof r.orphaned_at === 'string' ? r.orphaned_at : new Date().toISOString(),
    });
  }

  const forked = record.forked_from_version_id;
  return {
    schema: 1,
    items,
    orphans,
    forked_from_version_id: typeof forked === 'string' ? forked : null,
  };
}

/**
 * Serialise canonically — fixed key order, absent optionals written as null.
 *
 * Not cosmetic. This string is both what goes into a version and what dirty
 * tracking compares, so a document that merely spells itself differently must
 * not read as an edit; otherwise loading an outline and touching nothing would
 * report unsaved changes.
 */
export function serializeOutlineDocument(doc: OutlineDocument): string {
  return JSON.stringify({
    schema: 1,
    items: doc.items.map((i) => ({ id: i.id, title: i.title, abstract: i.abstract })),
    orphans: doc.orphans.map((o) => ({
      item_id: o.item_id,
      title: o.title,
      abstract: o.abstract,
      reason: o.reason,
      orphaned_at: o.orphaned_at,
    })),
    forked_from_version_id: doc.forked_from_version_id ?? null,
  });
}

/** Dirty tracking. Compares content, not object identity. */
export function sameDocument(a: OutlineDocument, b: OutlineDocument): boolean {
  return serializeOutlineDocument(a) === serializeOutlineDocument(b);
}

// --- editing ----------------------------------------------------------------

export function updateItem(
  doc: OutlineDocument,
  id: string,
  patch: Partial<Pick<OutlineItem, 'title' | 'abstract'>>
): OutlineDocument {
  return { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

/** Insert at a position. Index is clamped, so "insert below the last row" works. */
export function insertItemAt(
  doc: OutlineDocument,
  index: number,
  item: OutlineItem = newItem()
): OutlineDocument {
  const at = Math.max(0, Math.min(index, doc.items.length));
  const items = [...doc.items];
  items.splice(at, 0, item);
  return { ...doc, items };
}

export function moveItem(doc: OutlineDocument, id: string, toIndex: number): OutlineDocument {
  const from = doc.items.findIndex((i) => i.id === id);
  if (from === -1) return doc;
  const to = Math.max(0, Math.min(toIndex, doc.items.length - 1));
  if (to === from) return doc;

  const items = [...doc.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...doc, items };
}

export function moveItemBy(doc: OutlineDocument, id: string, delta: number): OutlineDocument {
  const from = doc.items.findIndex((i) => i.id === id);
  if (from === -1) return doc;
  return moveItem(doc, id, from + delta);
}

/**
 * Remove an item.
 *
 * `keepProse` is not a convenience flag — it is the whole point. A section the
 * user has written into cannot be removed as a silent side effect of tidying an
 * outline, so the caller must say explicitly whether the prose goes with it or
 * survives as an orphan.
 */
export function removeItem(
  doc: OutlineDocument,
  id: string,
  options: { keepProse: boolean; now?: string } = { keepProse: false }
): OutlineDocument {
  const item = doc.items.find((i) => i.id === id);
  if (!item) return doc;

  const items = doc.items.filter((i) => i.id !== id);
  if (!options.keepProse) return { ...doc, items };

  return {
    ...doc,
    items,
    orphans: [
      ...doc.orphans.filter((o) => o.item_id !== id),
      {
        item_id: item.id,
        title: item.title,
        abstract: item.abstract,
        reason: 'removed',
        orphaned_at: options.now ?? new Date().toISOString(),
      },
    ],
  };
}

/** Put an orphan back into the outline, keeping its id so its prose reattaches. */
export function reattachOrphan(
  doc: OutlineDocument,
  itemId: string,
  index = doc.items.length
): OutlineDocument {
  const orphan = doc.orphans.find((o) => o.item_id === itemId);
  if (!orphan) return doc;

  const restored: OutlineItem = {
    id: orphan.item_id,
    title: orphan.title,
    abstract: orphan.abstract,
  };
  return {
    ...insertItemAt(doc, index, restored),
    orphans: doc.orphans.filter((o) => o.item_id !== itemId),
  };
}

/** The one destructive operation, and it is never reached without being asked for. */
export function discardOrphan(doc: OutlineDocument, itemId: string): OutlineDocument {
  return { ...doc, orphans: doc.orphans.filter((o) => o.item_id !== itemId) };
}

// --- regeneration -----------------------------------------------------------

/** Replace one item's text while keeping its id, and therefore its prose. */
export function applyItemRegeneration(
  doc: OutlineDocument,
  id: string,
  fresh: Pick<OutlineItem, 'title' | 'abstract'>
): OutlineDocument {
  return updateItem(doc, id, { title: fresh.title, abstract: fresh.abstract });
}

/**
 * Replace the whole outline with a freshly generated one, without ever
 * discarding written prose.
 *
 * The naive implementation — assign the new list and be done — quietly deletes
 * every drafted section that the model happened not to propose again. Instead
 * any drafted item missing from the fresh outline becomes an orphan the user
 * can reattach. Ids of drafted items are preserved where the model returns a
 * matching one, so regenerating an outline does not detach prose that is still
 * wanted.
 */
export function mergeRegeneratedOutline(
  doc: OutlineDocument,
  fresh: Array<Partial<OutlineItem>>,
  draftedItemIds: Iterable<string>,
  now = new Date().toISOString()
): OutlineDocument {
  const drafted = new Set(draftedItemIds);

  const items = fresh.map((raw) => {
    const id = typeof raw.id === 'string' && doc.items.some((i) => i.id === raw.id) ? raw.id : newItemId();
    return newItem({ id, title: raw.title ?? '', abstract: raw.abstract ?? '' });
  });

  const surviving = new Set(items.map((i) => i.id));
  const newOrphans: OrphanedSection[] = doc.items
    .filter((i) => drafted.has(i.id) && !surviving.has(i.id))
    .map((i) => ({
      item_id: i.id,
      title: i.title,
      abstract: i.abstract,
      reason: 'regenerated' as const,
      orphaned_at: now,
    }));

  return {
    ...doc,
    items,
    orphans: [...doc.orphans.filter((o) => !surviving.has(o.item_id)), ...newOrphans],
  };
}

// --- versioning -------------------------------------------------------------

export type OutlineEditMode = 'fork' | 'in_place';

/**
 * Copy-on-write.
 *
 * Editing an APPROVED outline clones it into a new draft — the approved version
 * keeps standing, because drafting is bound to it and pulling it out from under
 * a half-written manuscript is exactly the failure this rule exists to prevent.
 * Editing a draft mutates that draft in place.
 */
export function editModeFor(headIsApproved: boolean): OutlineEditMode {
  return headIsApproved ? 'fork' : 'in_place';
}

/** Clone an approved version into an editable draft, item lineage intact. */
export function forkForEdit(doc: OutlineDocument, fromVersionId: string | null): OutlineDocument {
  return {
    schema: 1,
    // Same ids, new objects: lineage is preserved so drafted prose still
    // resolves, while nothing in the approved document can be mutated by
    // reference from the draft.
    items: doc.items.map((i) => ({ ...i })),
    orphans: doc.orphans.map((o) => ({ ...o })),
    forked_from_version_id: fromVersionId,
  };
}

export interface OutlineVersionView {
  version: ArtifactVersion;
  document: OutlineDocument;
  approved: boolean;
  approvedAt: string | null;
}

/**
 * Project the artifact's versions plus the approval events into what the UI
 * shows: an outline history where approval is a visible property of a version.
 */
export function outlineHistory(
  versions: ArtifactVersion[],
  approvals: Array<{ outline_version_id: string; created_at: string }>
): OutlineVersionView[] {
  const approvedAt = new Map<string, string>();
  for (const a of approvals) {
    if (!approvedAt.has(a.outline_version_id)) approvedAt.set(a.outline_version_id, a.created_at);
  }
  return versions.map((version) => ({
    version,
    document: parseOutlineDocument(version.content),
    approved: approvedAt.has(version.id),
    approvedAt: approvedAt.get(version.id) ?? null,
  }));
}

// --- drafting binding -------------------------------------------------------

export interface StaleDraftReport {
  /** Sections written against an outline version other than the approved one. */
  stale: SectionDraftBinding[];
  /** Version numbers those sections were written against, for the message. */
  versionNumbers: number[];
}

/**
 * Which prose was written against a superseded outline.
 *
 * A newer approval never invalidates prose. It surfaces this report — "3
 * sections were written against outline v1" — and offers a per-section rewrite,
 * leaving the decision with the person who wrote the words.
 */
export function staleDrafts(
  bindings: SectionDraftBinding[],
  approvedVersionId: string | null,
  versions: ArtifactVersion[] = []
): StaleDraftReport {
  if (!approvedVersionId) return { stale: [], versionNumbers: [] };

  const stale = bindings.filter(
    (b) => b.outline_version_id !== null && b.outline_version_id !== approvedVersionId
  );
  const numbers = new Set<number>();
  for (const b of stale) {
    const version = versions.find((v) => v.id === b.outline_version_id);
    if (version) numbers.add(version.version_number);
  }
  return { stale, versionNumbers: [...numbers].sort((a, b) => a - b) };
}
