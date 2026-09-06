import { describe, expect, it } from 'vitest';

import {
  applyItemRegeneration,
  discardOrphan,
  editModeFor,
  emptyDocument,
  forkForEdit,
  insertItemAt,
  mergeRegeneratedOutline,
  moveItem,
  moveItemBy,
  newItem,
  outlineHistory,
  parseOutlineDocument,
  reattachOrphan,
  removeItem,
  sameDocument,
  serializeOutlineDocument,
  staleDrafts,
  updateItem,
} from './model';
import { applyOutlineEdit } from './use-outline-draft';
import type { OutlineDocument } from '@/types/outline';
import type { ArtifactVersion } from '@/types/project';

function doc(titles: string[]): OutlineDocument {
  return {
    schema: 1,
    items: titles.map((t, i) => newItem({ id: `i${i + 1}`, title: t, abstract: `about ${t}` })),
    orphans: [],
  };
}

const titles = (d: OutlineDocument) => d.items.map((i) => i.title);

function version(overrides: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: 'v1',
    user_id: 'u1',
    project_id: 'p1',
    artifact_id: 'a1',
    version_number: 1,
    parent_version_id: null,
    source_operation: 'outline_edit',
    instruction: '',
    system_prompt: '',
    content: serializeOutlineDocument(doc(['One', 'Two'])),
    model: '',
    mode: 'architect',
    change_summary: null,
    restored_from_version_id: null,
    finish_reason: null,
    user_rating: null,
    continuity_snapshot: null,
    created_at: '2026-09-04T00:00:00Z',
    ...overrides,
  };
}

describe('parsing', () => {
  it('survives content a model wrote badly rather than losing the outline', () => {
    const parsed = parseOutlineDocument(
      JSON.stringify({
        items: [
          { title: 'Real', abstract: 'kept' },
          'not an object',
          { abstract: '' },
          { id: 'keeps-its-id', title: 'Second', abstract: '' },
        ],
      })
    );
    // The malformed rows are skipped, not fatal; the good ones survive.
    expect(titles(parsed)).toEqual(['Real', 'Second']);
    expect(parsed.items[1].id).toBe('keeps-its-id');
    // A missing id is backfilled rather than left undefined.
    expect(parsed.items[0].id).toBeTruthy();
  });

  it('accepts a bare array, which is what a generator most naturally emits', () => {
    expect(titles(parseOutlineDocument(JSON.stringify([{ title: 'A', abstract: '' }])))).toEqual(['A']);
  });

  it('treats unparseable content as an empty outline, never a crash', () => {
    expect(parseOutlineDocument('{oh no').items).toEqual([]);
    expect(parseOutlineDocument('').items).toEqual([]);
    expect(parseOutlineDocument(null).items).toEqual([]);
  });

  it('round-trips', () => {
    const d = doc(['A', 'B']);
    expect(sameDocument(parseOutlineDocument(serializeOutlineDocument(d)), d)).toBe(true);
  });
});

describe('reorder and insert', () => {
  it('moves an item to a position and clamps at the ends', () => {
    const d = doc(['A', 'B', 'C']);
    expect(titles(moveItem(d, 'i3', 0))).toEqual(['C', 'A', 'B']);
    expect(titles(moveItemBy(d, 'i1', -1))).toEqual(['A', 'B', 'C']);
    expect(titles(moveItemBy(d, 'i3', 5))).toEqual(['A', 'B', 'C']);
  });

  it('inserts at a position, not only at the end', () => {
    const d = doc(['A', 'C']);
    const next = insertItemAt(d, 1, newItem({ id: 'x', title: 'B' }));
    expect(titles(next)).toEqual(['A', 'B', 'C']);
  });

  it('leaves the source document untouched', () => {
    const d = doc(['A', 'B']);
    moveItemBy(d, 'i1', 1);
    updateItem(d, 'i1', { title: 'changed' });
    expect(titles(d)).toEqual(['A', 'B']);
  });
});

describe('removing a section with prose', () => {
  it('keeps the writing as an orphan when asked to', () => {
    const next = removeItem(doc(['A', 'B']), 'i1', { keepProse: true, now: 'T' });
    expect(titles(next)).toEqual(['B']);
    expect(next.orphans).toEqual([
      { item_id: 'i1', title: 'A', abstract: 'about A', reason: 'removed', orphaned_at: 'T' },
    ]);
  });

  it('reattaches an orphan under its original id, so its prose finds it again', () => {
    const removed = removeItem(doc(['A', 'B']), 'i1', { keepProse: true });
    const back = reattachOrphan(removed, 'i1', 0);
    expect(titles(back)).toEqual(['A', 'B']);
    expect(back.items[0].id).toBe('i1');
    expect(back.orphans).toEqual([]);
  });

  it('discards only when told to', () => {
    const removed = removeItem(doc(['A']), 'i1', { keepProse: true });
    expect(discardOrphan(removed, 'i1').orphans).toEqual([]);
  });
});

describe('regeneration', () => {
  it('keeps an item id when regenerating one section, so prose stays attached', () => {
    const next = applyItemRegeneration(doc(['A', 'B']), 'i2', { title: 'B better', abstract: 'x' });
    expect(next.items[1]).toMatchObject({ id: 'i2', title: 'B better' });
  });

  it('orphans drafted sections a whole-outline regenerate dropped, rather than deleting them', () => {
    const next = mergeRegeneratedOutline(
      doc(['A', 'B', 'C']),
      [{ id: 'i1', title: 'A again', abstract: '' }, { title: 'Brand new', abstract: '' }],
      ['i2'],
      'T'
    );

    expect(titles(next)).toEqual(['A again', 'Brand new']);
    // i2 had writing and is gone from the fresh outline: kept, not destroyed.
    expect(next.orphans).toEqual([
      { item_id: 'i2', title: 'B', abstract: 'about B', reason: 'regenerated', orphaned_at: 'T' },
    ]);
    // i3 had nothing written, so there is nothing to preserve.
    expect(next.orphans.some((o) => o.item_id === 'i3')).toBe(false);
    // A surviving id is reused; an unrecognised one is minted fresh.
    expect(next.items[0].id).toBe('i1');
    expect(next.items[1].id).not.toBe('i1');
  });
});

describe('copy-on-write versioning', () => {
  it('forks an approved outline and mutates an unapproved one in place', () => {
    expect(editModeFor(true)).toBe('fork');
    expect(editModeFor(false)).toBe('in_place');
  });

  it('preserves item lineage across a fork', () => {
    const forked = forkForEdit(doc(['A', 'B']), 'v2');
    expect(forked.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(forked.forked_from_version_id).toBe('v2');
  });

  it('editing an approved outline produces a draft and leaves the version alone', () => {
    const head = doc(['A', 'B']);
    const edited = updateItem(head, 'i1', { title: 'A changed' });

    const draft = applyOutlineEdit(
      { head, headVersionId: 'v2', headApproved: true, draft: null },
      edited
    );

    expect(draft).not.toBeNull();
    expect(draft!.forked_from_version_id).toBe('v2');
    expect(titles(head)).toEqual(['A', 'B']);
  });

  it('editing a draft keeps mutating that draft rather than forking again', () => {
    const head = doc(['A']);
    const first = applyOutlineEdit(
      { head, headVersionId: 'v2', headApproved: true, draft: null },
      updateItem(head, 'i1', { title: 'once' })
    )!;
    const second = applyOutlineEdit(
      { head, headVersionId: 'v2', headApproved: true, draft: first },
      updateItem(first, 'i1', { title: 'twice' })
    )!;

    expect(second.items[0].title).toBe('twice');
    expect(second.forked_from_version_id).toBe('v2');
  });

  it('drops the draft when an unapproved outline is edited back to where it started', () => {
    const head = doc(['A']);
    const there = applyOutlineEdit(
      { head, headVersionId: 'v2', headApproved: false, draft: null },
      updateItem(head, 'i1', { title: 'B' })
    )!;
    const back = applyOutlineEdit(
      { head, headVersionId: 'v2', headApproved: false, draft: there },
      head
    );
    expect(back).toBeNull();
  });
});

describe('history and drafting binding', () => {
  it('marks which versions were approved', () => {
    const history = outlineHistory(
      [version({ id: 'v1', version_number: 1 }), version({ id: 'v2', version_number: 2 })],
      [{ outline_version_id: 'v1', created_at: 'T' }]
    );
    expect(history.map((h) => h.approved)).toEqual([true, false]);
    expect(history[0].document.items).toHaveLength(2);
  });

  it('reports prose written against a superseded outline instead of invalidating it', () => {
    const versions = [version({ id: 'v1', version_number: 1 }), version({ id: 'v2', version_number: 2 })];
    const report = staleDrafts(
      [
        { item_id: 'i1', outline_version_id: 'v1', word_count: 900 },
        { item_id: 'i2', outline_version_id: 'v1', word_count: 400 },
        { item_id: 'i3', outline_version_id: 'v2', word_count: 100 },
      ],
      'v2',
      versions
    );
    expect(report.stale).toHaveLength(2);
    expect(report.versionNumbers).toEqual([1]);
  });

  it('reports nothing while no outline is approved', () => {
    expect(
      staleDrafts([{ item_id: 'i1', outline_version_id: 'v1', word_count: 10 }], null).stale
    ).toEqual([]);
  });
});

describe('empty document', () => {
  it('is a valid outline, not a null', () => {
    expect(emptyDocument()).toEqual({ schema: 1, items: [], orphans: [] });
  });
});
