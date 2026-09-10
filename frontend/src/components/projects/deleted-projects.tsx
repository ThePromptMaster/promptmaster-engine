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

function retentionLabel(deletedAt: string): string {
  const left = daysLeft(deletedAt);
  if (left <= 0) return 'Due to be removed';
  if (left === 1) return 'Removed for good tomorrow';
  return `Removed for good in ${left} days`;
}

export function DeletedProjects({ onRestored }: { onRestored?: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DeletedProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listDeletedProjects()
      .then(setRows)
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Could not load deleted projects.')
      );
  }, []);

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
      setError(e instanceof Error ? e.message : 'Could not restore the project.');
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
      setError(e instanceof Error ? e.message : 'Could not delete the project.');
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
        Recently deleted
        {rows && rows.length > 0 && <span> · {rows.length}</span>}
      </button>

      {open && (
        <div className="mt-3">
          <p className="mb-3 max-w-[70ch] text-label text-[var(--on-surface-variant)]">
            Deleted projects are kept for {RETENTION_DAYS} days so a mistake can be undone,
            then removed permanently along with their artifacts, versions and evaluations.
            Delete now if you would rather not wait.
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
              Nothing deleted.
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
                    {p.title || 'Untitled project'}
                  </span>
                  <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                    {retentionLabel(p.deleted_at)}
                  </span>
                </span>

                {confirming === p.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-label text-[var(--on-surface-variant)]">
                      Delete permanently? This cannot be undone.
                    </span>
                    <button
                      onClick={() => handlePurge(p.id)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--pm-error)] px-3 py-1.5 text-label text-[var(--on-error)] disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg px-2 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                    >
                      Keep
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
                      Restore
                    </button>
                    <button
                      onClick={() => setConfirming(p.id)}
                      className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
                    >
                      Delete now
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
