'use client';

/**
 * The furniture every stage renderer shares: the version pill row and the
 * generation bar.
 *
 * Split out rather than duplicated three times, because "which version am I
 * looking at" and "is a draft running" must look and behave identically
 * whether the stage holds prose, a list or a table. A user who learns the
 * version pills on the Objective stage should not have to relearn them on the
 * claim table.
 */

import type { ArtifactVersion } from '@/types/project';

interface VersionBarProps {
  versions: ArtifactVersion[];
  activeVersionId: string | null;
  headVersionId: string | null;
  onSelect: (versionId: string | null) => void;
  onRestore: (versionId: string) => Promise<void>;
  readOnly: boolean;
}

export function VersionBar({
  versions,
  activeVersionId,
  headVersionId,
  onSelect,
  onRestore,
  readOnly,
}: VersionBarProps) {
  if (versions.length === 0) return null;

  const active = versions.find((v) => v.id === activeVersionId) ?? versions.at(-1)!;
  const isHead = active.id === (headVersionId ?? versions.at(-1)!.id);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Version history">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            aria-pressed={v.id === active.id}
            title={v.change_summary ?? v.source_operation}
            className={`rounded-lg px-3 py-1.5 text-label transition-colors ${
              v.id === active.id
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
            }`}
          >
            v{v.version_number}
            {v.restored_from_version_id && (
              <span aria-label=" (restored)" title="Restored"> ↩</span>
            )}
          </button>
        ))}
      </div>

      {/* Restoring appends a new version rather than rewinding — reachable
          only while looking at an older one, so browsing stays free. */}
      {!isHead && !readOnly && (
        <button
          onClick={() => void onRestore(active.id)}
          className="ml-auto rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
        >
          Restore v{active.version_number}
        </button>
      )}
    </div>
  );
}

interface GenerationBarProps {
  /** Singular noun for what is being drafted, e.g. "positioning statement". */
  label: string;
  generating: boolean;
  error: string | null;
  hasContent: boolean;
  onGenerate: (options?: { force?: boolean }) => void;
  onCancel: () => void;
  readOnly: boolean;
}

/**
 * Drafting state, always visible.
 *
 * Regenerating over existing work asks first. The artifact is versioned so
 * nothing is truly lost, but "your edits were replaced, check the history" is
 * a bad thing to learn after the fact.
 */
export function GenerationBar({
  label,
  generating,
  error,
  hasContent,
  onGenerate,
  onCancel,
  readOnly,
}: GenerationBarProps) {
  if (readOnly) return null;

  if (generating) {
    return (
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3"
      >
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--pm-primary)] border-t-transparent"
        />
        <span className="text-body text-[var(--on-surface-variant)]">Drafting the {label}…</span>
        <button
          onClick={onCancel}
          className="ml-auto rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {error && (
        // --pm-tertiary is the warning tone in this dialect; a failed draft is
        // recoverable by pressing the button again, not an error state.
        <p className="text-label text-[var(--pm-tertiary)]" role="alert">
          {error}
        </p>
      )}
      <button
        onClick={() => onGenerate()}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          {hasContent ? 'refresh' : 'auto_awesome'}
        </span>
        {hasContent ? 'Regenerate' : `Draft the ${label}`}
      </button>
    </div>
  );
}

/** Shown while a stage has nothing and nothing is running. */
export function EmptyStage({ label }: { label: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-12 text-center">
      <p className="text-body text-[var(--on-surface-variant)]">
        No {label} yet. Draft one, or write it yourself.
      </p>
    </div>
  );
}

interface ConfirmOverwriteProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmOverwrite({ label, onConfirm, onCancel }: ConfirmOverwriteProps) {
  return (
    <div className="mb-4 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="text-body text-[var(--on-surface)]">
        Regenerating replaces the {label} on the page. Your current version stays in the history.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
        >
          Regenerate
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
        >
          Keep what I have
        </button>
      </div>
    </div>
  );
}
