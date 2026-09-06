'use client';

import type { DerivedOutlineDrift } from '@/lib/workflow/derived-outline';

/**
 * "The work behind this outline has changed since it was approved."
 *
 * The counterpart to StaleDraftsNotice, and built to the same rule: say what
 * moved, name it, and leave the decision with the person who did the work.
 * Re-deriving is offered, never performed — an approved outline is what
 * drafting is bound to, and replacing it without being asked would pull the
 * plan out from under a half-written paper. Nothing written is discarded
 * either way; a section that leaves the outline lands in the orphan tray.
 */

interface Props {
  drift: DerivedOutlineDrift;
  onRederive?: () => void;
  busy?: boolean;
}

export function DerivedOutlineNotice({ drift, onRederive, busy = false }: Props) {
  const lines: Array<{ key: string; label: string; titles: string[] }> = [
    { key: 'changed', label: 'Now briefed differently', titles: drift.changed.map((i) => i.title) },
    { key: 'added', label: 'New, from a stage since completed', titles: drift.added.map((i) => i.title) },
    { key: 'removed', label: 'No stage feeds these any more', titles: drift.removed.map((i) => i.title) },
  ].filter((l) => l.titles.length > 0);

  if (lines.length === 0) return null;

  return (
    <section
      aria-labelledby="derived-outline-drift-heading"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--pm-tertiary)]">
          sync_problem
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="derived-outline-drift-heading" className="text-title text-[var(--on-surface)]">
            An earlier stage changed after this outline was approved
          </h3>
          <p className="mt-1 text-body text-[var(--on-surface-variant)]">
            The approved outline still stands and nothing written has been touched. Re-derive only
            if the change actually affects the shape of the write-up.
          </p>

          <dl className="mt-3 space-y-2">
            {lines.map((line) => (
              <div
                key={line.key}
                className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5"
              >
                <dt className="text-label text-[var(--on-surface-variant)]">{line.label}</dt>
                <dd className="mt-0.5 text-body text-[var(--on-surface)]">
                  {line.titles.join(', ')}
                </dd>
              </div>
            ))}
          </dl>

          {onRederive && (
            <button
              type="button"
              onClick={onRederive}
              disabled={busy}
              className="mt-3 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label font-semibold text-[var(--on-surface)] disabled:opacity-50"
            >
              Re-derive from the stages
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
