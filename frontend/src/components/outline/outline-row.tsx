'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import type { OutlineItem } from '@/types/outline';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';

/**
 * One outline section: its text, its position, and everything you can do to it.
 *
 * Reorder is buttons first and drag never-instead. Drag alone is unusable at
 * thirty rows and unreachable from a keyboard; the buttons are the real
 * mechanism and Alt+Arrow is the accelerator over the top of it.
 */

export interface OutlineRowProps {
  item: OutlineItem;
  index: number;
  total: number;
  readOnly: boolean;
  /** Words already written against this section, if any. */
  words: number;
  regenerating: boolean;
  onChange: (patch: Partial<Pick<OutlineItem, 'title' | 'abstract'>>) => void;
  onMove: (delta: number) => void;
  onInsertBelow: () => void;
  onRegenerate?: () => void;
  onRemove: (keepProse: boolean) => void;
}

const ICON_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:pointer-events-none disabled:opacity-30';

export function OutlineRow({
  item,
  index,
  total,
  readOnly,
  words,
  regenerating,
  onChange,
  onMove,
  onInsertBelow,
  onRegenerate,
  onRemove,
}: OutlineRowProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const name = item.title.trim() || t('ol.sectionN', { n: index + 1 });

  function handleKeyDown(event: React.KeyboardEvent) {
    // Alt+Arrow is the accelerator, not the mechanism. Alt, because plain
    // arrows must keep moving the caret inside the title and abstract fields.
    if (!event.altKey || readOnly) return;
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'ArrowDown' && index < total - 1) {
      event.preventDefault();
      onMove(1);
    }
  }

  function requestRemove() {
    // Removing a section that has prose in it is never a one-click action; a
    // section with nothing written is not worth a dialog.
    if (words > 0) setConfirming(true);
    else onRemove(false);
  }

  return (
    <li
      className="rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3.5"
      onKeyDown={handleKeyDown}
    >
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-container-high)] text-label text-[var(--on-surface-variant)]"
          >
            {index + 1}
          </span>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={index === 0}
                data-outline-focus={`${item.id}:up`}
                aria-label={t('ol.moveUp', { name, n: index })}
                className={ICON_BUTTON}
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  keyboard_arrow_up
                </span>
              </button>
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                data-outline-focus={`${item.id}:down`}
                aria-label={t('ol.moveDown', { name, n: index + 2 })}
                className={ICON_BUTTON}
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">
                  keyboard_arrow_down
                </span>
              </button>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="text"
            value={item.title}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={readOnly}
            aria-label={t('ol.titleOf', { n: index + 1 })}
            placeholder={t('ol.titlePh')}
            className="w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-title text-[var(--on-surface)] outline-none placeholder:font-normal placeholder:text-[var(--on-surface-variant)] disabled:opacity-70"
          />
          <AutoGrowTextarea
            value={item.abstract}
            onChange={(e) => onChange({ abstract: e.target.value })}
            disabled={readOnly}
            rows={2}
            aria-label={t('ol.coversOf', { n: index + 1 })}
            placeholder={t('ol.coversPh')}
            className="w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] disabled:opacity-70"
          />

          {words > 0 && (
            <p className="text-label text-[var(--on-surface-variant)]">
              {t('ol.wordsWritten', { n: words.toLocaleString() })}
            </p>
          )}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-col gap-1">
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={regenerating}
                aria-label={t('ol.regenerateLabel', { name })}
                className={ICON_BUTTON}
              >
                <span
                  aria-hidden
                  className={`material-symbols-outlined text-[18px] ${regenerating ? 'animate-spin' : ''}`}
                >
                  {regenerating ? 'progress_activity' : 'autorenew'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onInsertBelow}
              aria-label={t('ol.insertAfter', { name })}
              className={ICON_BUTTON}
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                add
              </span>
            </button>
            <button
              type="button"
              onClick={requestRemove}
              aria-label={t('ol.removeLabel', { name })}
              className={ICON_BUTTON}
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                delete
              </span>
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="mt-3 rounded-lg bg-[var(--surface-container-high)] px-4 py-3">
          <p className="text-body text-[var(--on-surface)]">
            {t('ol.hasWords', { name, n: words.toLocaleString() })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRemove(true);
              }}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-body text-[var(--on-primary)] transition-opacity hover:opacity-90"
            >
              {t('ol.keepDraft')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRemove(false);
              }}
              className="rounded-lg px-4 py-2 text-body text-[var(--pm-error)] hover:bg-[var(--surface-container-highest)]"
            >
              {t('ol.deleteDraft')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-4 py-2 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              {t('pnl.cancel')}
            </button>
          </div>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            {t('ol.keepingMoves')}
          </p>
        </div>
      )}
    </li>
  );
}
