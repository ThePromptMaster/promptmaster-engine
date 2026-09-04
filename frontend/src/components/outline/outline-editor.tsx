'use client';

import { useEffect, useRef, useState } from 'react';

import { OutlineRow } from './outline-row';
import { OrphanTray } from './orphan-tray';
import { StaleDraftsNotice } from './stale-drafts-notice';
import {
  discardOrphan,
  insertItemAt,
  moveItemBy,
  newItem,
  reattachOrphan,
  removeItem,
  updateItem,
  type StaleDraftReport,
} from '@/lib/outline/model';
import type { OutlineDocument, OutlineItem, SectionDraftBinding } from '@/types/outline';

/**
 * The outline editor (FR-07).
 *
 * Controlled: it owns no outline state, only the transient UI around one
 * (a pending confirmation, the last announcement). Every verb produces a new
 * document and hands it to the caller, which is what lets the copy-on-write
 * rule live outside this file and be tested without a DOM.
 */

export interface OutlineEditorProps {
  document: OutlineDocument;
  onChange: (next: OutlineDocument) => void;

  /** Prose that exists, per outline item. Supplied by the drafting surface. */
  drafts?: SectionDraftBinding[];
  staleDrafts?: StaleDraftReport;
  onRewriteSection?: (itemId: string) => void;

  readOnly?: boolean;

  // Versioning surface.
  isDraft?: boolean;
  headVersionNumber?: number | null;
  approvedVersionNumber?: number | null;
  forkedFromVersionNumber?: number | null;
  busy?: boolean;

  onSaveDraft?: () => void;
  onDiscardDraft?: () => void;
  onApprove?: () => void;

  onRegenerateAll?: () => void;
  onRegenerateItem?: (itemId: string) => void;
  regeneratingItemId?: string | null;
  regeneratingAll?: boolean;
}

export function OutlineEditor({
  document: doc,
  onChange,
  drafts = [],
  staleDrafts,
  onRewriteSection,
  readOnly = false,
  isDraft = false,
  headVersionNumber = null,
  approvedVersionNumber = null,
  forkedFromVersionNumber = null,
  busy = false,
  onSaveDraft,
  onDiscardDraft,
  onApprove,
  onRegenerateAll,
  onRegenerateItem,
  regeneratingItemId = null,
  regeneratingAll = false,
}: OutlineEditorProps) {
  const [announcement, setAnnouncement] = useState('');
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const pendingFocus = useRef<string | null>(null);

  const wordsById = new Map(drafts.map((d) => [d.item_id, d.word_count]));
  const wordsFor = (id: string) => wordsById.get(id) ?? 0;
  const draftedIds = drafts.filter((d) => d.word_count > 0).map((d) => d.item_id);

  // A move that lands an item at either end disables the button that was just
  // pressed, which would drop focus to the document body. Hand it to the
  // opposite button on the same row so keyboard reordering can carry on.
  useEffect(() => {
    const selector = pendingFocus.current;
    pendingFocus.current = null;
    if (!selector) return;
    const el = window.document.querySelector<HTMLButtonElement>(
      `[data-outline-focus="${selector}"]`
    );
    if (el && !el.disabled) el.focus();
  });

  function move(item: OutlineItem, index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= doc.items.length) return;

    if (to === 0 && delta < 0) pendingFocus.current = `${item.id}:down`;
    else if (to === doc.items.length - 1 && delta > 0) pendingFocus.current = `${item.id}:up`;

    onChange(moveItemBy(doc, item.id, delta));
    setAnnouncement(
      `“${item.title.trim() || `Section ${index + 1}`}” moved to position ${to + 1} of ${doc.items.length}.`
    );
  }

  function insertAt(index: number) {
    const item = newItem();
    onChange(insertItemAt(doc, index, item));
    setAnnouncement(`New section inserted at position ${index + 1}.`);
  }

  function regenerateAll() {
    // Regenerating never deletes writing, but a user about to lose the shape
    // of an outline they have written into deserves to be told what happens.
    if (draftedIds.length > 0) setConfirmRegenerate(true);
    else onRegenerateAll?.();
  }

  const showActions = !readOnly && (onSaveDraft || onDiscardDraft || onApprove || onRegenerateAll);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-headline text-[var(--on-surface)]">Outline</h2>
            <p className="mt-1 text-body text-[var(--on-surface-variant)]">
              Shape the argument before writing it. Moving a section here costs nothing; later it
              costs a rewrite.
            </p>
          </div>
          <VersionPill
            isDraft={isDraft}
            headVersionNumber={headVersionNumber}
            approvedVersionNumber={approvedVersionNumber}
            forkedFromVersionNumber={forkedFromVersionNumber}
          />
        </div>

        {/* Reorder is announced, not merely animated: a screen-reader user who
            presses "move up" gets told where the section landed. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {doc.items.length === 0 ? (
          <p className="mt-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-8 text-center text-body text-[var(--on-surface-variant)]">
            No sections yet. Add one, or generate an outline to start from.
          </p>
        ) : (
          <ol className="mt-5 space-y-2.5">
            {doc.items.map((item, index) => (
              <OutlineRow
                key={item.id}
                item={item}
                index={index}
                total={doc.items.length}
                readOnly={readOnly}
                words={wordsFor(item.id)}
                regenerating={regeneratingItemId === item.id}
                onChange={(patch) => onChange(updateItem(doc, item.id, patch))}
                onMove={(delta) => move(item, index, delta)}
                onInsertBelow={() => insertAt(index + 1)}
                onRegenerate={onRegenerateItem ? () => onRegenerateItem(item.id) : undefined}
                onRemove={(keepProse) => {
                  onChange(removeItem(doc, item.id, { keepProse }));
                  setAnnouncement(
                    `“${item.title.trim() || `Section ${index + 1}`}” removed${
                      keepProse ? '; its writing was kept' : ''
                    }.`
                  );
                }}
              />
            ))}
          </ol>
        )}

        {!readOnly && (
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Append stays: insert-at-position lives on each row, but adding
                to the end is the common case and should not require finding
                the last row first. */}
            <button
              type="button"
              onClick={() => insertAt(doc.items.length)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-body text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-high)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                add
              </span>
              Add a section
            </button>

            {onRegenerateAll && (
              <button
                type="button"
                onClick={regenerateAll}
                disabled={regeneratingAll || busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-low)] hover:text-[var(--on-surface)] disabled:opacity-40"
              >
                <span
                  aria-hidden
                  className={`material-symbols-outlined text-[18px] ${regeneratingAll ? 'animate-spin' : ''}`}
                >
                  {regeneratingAll ? 'progress_activity' : 'autorenew'}
                </span>
                {regeneratingAll ? 'Regenerating…' : 'Regenerate the outline'}
              </button>
            )}
          </div>
        )}

        {confirmRegenerate && (
          <div className="mt-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
            <p className="text-body text-[var(--on-surface)]">
              Regenerating replaces the section list. {draftedIds.length} section
              {draftedIds.length === 1 ? '' : 's'} you have already written will be kept as
              detached sections, not deleted — you can put any of them back.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmRegenerate(false);
                  onRegenerateAll?.();
                }}
                className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-body text-[var(--on-primary)] transition-opacity hover:opacity-90"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => setConfirmRegenerate(false)}
                className="rounded-lg px-4 py-2 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <OrphanTray
        orphans={doc.orphans}
        wordsFor={wordsFor}
        readOnly={readOnly}
        onReattach={(id) => {
          onChange(reattachOrphan(doc, id));
          setAnnouncement('Section put back into the outline.');
        }}
        onDiscard={(id) => onChange(discardOrphan(doc, id))}
      />

      {staleDrafts && (
        <StaleDraftsNotice
          report={staleDrafts}
          titleFor={(id) =>
            doc.items.find((i) => i.id === id)?.title.trim() ||
            doc.orphans.find((o) => o.item_id === id)?.title.trim() ||
            'Untitled section'
          }
          onRewrite={onRewriteSection}
        />
      )}

      {showActions && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
          <span className="mr-auto text-label text-[var(--on-surface-variant)]">
            {isDraft
              ? 'Unsaved changes. Approving saves them as a new version first.'
              : approvedVersionNumber !== null
                ? `Drafting is using outline v${approvedVersionNumber}.`
                : 'Nothing approved yet — drafting has no outline to write against.'}
          </span>

          {isDraft && onDiscardDraft && (
            <button
              type="button"
              onClick={onDiscardDraft}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-body text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-40"
            >
              Discard changes
            </button>
          )}

          {isDraft && onSaveDraft && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
            >
              Save draft
            </button>
          )}

          {onApprove && (
            <button
              type="button"
              onClick={onApprove}
              disabled={busy || doc.items.length === 0}
              className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-body font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {isDraft ? 'Save and approve' : 'Approve this outline'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VersionPill({
  isDraft,
  headVersionNumber,
  approvedVersionNumber,
  forkedFromVersionNumber,
}: {
  isDraft: boolean;
  headVersionNumber: number | null;
  approvedVersionNumber: number | null;
  forkedFromVersionNumber: number | null;
}) {
  if (isDraft) {
    // "from vN" is reserved for a genuine fork of an APPROVED version, because
    // that is the case where two documents now exist and the user needs to know
    // which one drafting is still using. An ordinary draft is just a draft.
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--pm-tertiary)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          edit_note
        </span>
        {forkedFromVersionNumber !== null ? `Draft, from v${forkedFromVersionNumber}` : 'Draft'}
      </span>
    );
  }

  if (approvedVersionNumber !== null && approvedVersionNumber === headVersionNumber) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--pm-secondary)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          check_circle
        </span>
        Approved · v{approvedVersionNumber}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
      {headVersionNumber !== null ? `v${headVersionNumber}` : 'Not saved yet'}
    </span>
  );
}
