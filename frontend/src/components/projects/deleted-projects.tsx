'use client';

/**
 * FR-20: the other half of deleting.
 *
 * `softDeleteProject` set `deleted_at` and the list filtered the row out, and
 * that was the whole feature. `restoreProject` and `hardDeleteProject` existed
 * with no callers, and the purge their docstring promised did not exist — so a
 * deleted project was neither recoverable nor actually gone.
 *
 * This is where both become true. Restore puts the project back; Delete
 * permanently removes it now rather than in thirty days, which is what someone
 * who pasted something they should not have into a beta actually needs.
 *
 * Collapsed by default. Trash is a place you go looking for, and a permanently
 * open list of things the user already decided to throw away is clutter on the
 * screen they use for work.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import {
  hardDeleteProject,
  listDeletedProjects,
  restoreProject,
} from '@/lib/supabase/projects';
import type { DeletedProjectSummary } from '@/types/project';

/** Matches `purge_deleted_projects()`'s default. */
const RETENTION_DAYS = 30;

export function daysLeft(deletedAt: string, now: number = Date.now()): number {
  const elapsed = (now - new Date(deletedAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsed));
}

function retentionLabel(deletedAt: string, t: ReturnType<typeof useT>): string {
  const left = daysLeft(deletedAt);
  if (left <= 0) return t('trash.due');
  if (left === 1) return t('trash.tomorrow');
  return t('trash.inDays', { days: left });
}

export function DeletedProjects({ onRestored }: { onRestored?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DeletedProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listDeletedProjects()
      .then(setRows)
      .catch((e) =>
        setError(e instanceof Error ? e.message : t('trash.loadError'))
      );
  }, [t]);

  useEffect(() => {
    if (open && rows === null) load();
  }, [open, rows, load]);

  async function handleRestore(id: string) {
    setBusy(true);
    setError(null);
    try {
      await restoreProject(id);
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
      onRestored?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trash.restoreError'));
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge(id: string) {
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      await hardDeleteProject(id);
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trash.deleteError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-10">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
      >
        <span
          aria-hidden
          className="material-symbols-outlined text-[18px] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        >
          chevron_right
        </span>
        {t('trash.heading')}
        {rows && rows.length > 0 && <span> · {rows.length}</span>}
      </button>

      {open && (
        <div className="mt-3">
          <p className="mb-3 max-w-[70ch] text-label text-[var(--on-surface-variant)]">
            {t('trash.explain', { days: RETENTION_DAYS })}
          </p>

          {error && (
            <div className="mb-3 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
              {error}
            </div>
          )}

          {rows === null && (
            <div className="h-[64px] animate-pulse rounded-2xl bg-[var(--surface-container-low)]" />
          )}

          {rows?.length === 0 && (
            <p className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-5 text-body text-[var(--on-surface-variant)]">
              {t('trash.nothing')}
            </p>
          )}

          <ul className="space-y-2">
            {(rows ?? []).map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl bg-[var(--surface-container-low)] px-6 py-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-title text-[var(--on-surface)]">
                    {p.title || t('list.untitled')}
                  </span>
                  <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                    {retentionLabel(p.deleted_at, t)}
                  </span>
                </span>

                {confirming === p.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-label text-[var(--on-surface-variant)]">
                      {t('trash.confirm')}
                    </span>
                    <button
                      onClick={() => handlePurge(p.id)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--pm-error)] px-3 py-1.5 text-label text-[var(--on-error)] disabled:opacity-50"
                    >
                      {t('trash.deletePermanently')}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg px-2 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                    >
                      {t('trash.keep')}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestore(p.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-50"
                    >
                      <span aria-hidden className="material-symbols-outlined text-[16px]">
                        restore_from_trash
                      </span>
                      {t('trash.restore')}
                    </button>
                    <button
                      onClick={() => setConfirming(p.id)}
                      className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
                    >
                      {t('trash.deleteNow')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
