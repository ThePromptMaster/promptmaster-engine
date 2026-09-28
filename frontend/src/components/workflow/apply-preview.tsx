'use client';

/**
 * What is about to happen, before it happens — FR-09 and FR-15.
 *
 * FR-09's acceptance criterion is "the affected scope is shown before
 * application and the prior version remains recoverable". **This dialog is
 * that criterion.** It opens with no model call made and none scheduled:
 * everything on it — the combined instruction, the scope, the version
 * arithmetic — is computed from rows already in memory. Nothing is spent until
 * the user presses Apply, and there is a test asserting the api mock has not
 * been called when the dialog renders.
 *
 * FR-15 adds three things to the same surface: the selected actions are
 * visible and removable, the combined instruction is visible, and obvious
 * conflicts trigger a warning.
 *
 * ## The warning does not block
 *
 * A detected conflict is drawn in `--pm-tertiary` and Apply stays enabled.
 * That is the house rule — "guidance is suggestive, not restrictive", the same
 * rule that keeps Advance live with criteria unmet — and FR-12 says in as many
 * words that the user may proceed. Two instructions that pull opposite ways
 * are often exactly what someone means: shorten the argument *and* add
 * evidence for the part that survives. Saying so and getting out of the way is
 * the whole behaviour.
 */

import { useState } from 'react';

import { buildCombinedInstruction, detectConflicts } from '@/lib/workflow/combine';
import { describeScope, type ProposedRecommendation } from '@/lib/workflow/recommend';

export interface PreviewRecommendation
  extends Pick<
    ProposedRecommendation,
    'category' | 'kind' | 'title' | 'instruction' | 'scope' | 'severity' | 'tags'
  > {
  /** The row id, when this recommendation has been persisted. */
  id?: string;
}

interface Props {
  selected: PreviewRecommendation[];
  /** The version this would be applied to. Null when the stage has nothing yet. */
  headVersionNumber: number | null;
  stageLabel: string;
  applying: boolean;
  error: string | null;
  onRemove: (category: string) => void;
  /**
   * PM-22: with `showFirst`, the revision is shown as a diff before anything is
   * saved. PM-24: `precedence` — for each pair that pulls opposite ways, which
   * one the user said controls, sent to the model with the fixes as sentences.
   */
  onApply: (options: { showFirst: boolean; precedence: string[] }) => void;
  onCancel: () => void;
}

export function ApplyPreview({
  selected,
  headVersionNumber,
  stageLabel,
  applying,
  error,
  onRemove,
  onApply,
  onCancel,
}: Props) {
  const [showFirst, setShowFirst] = useState(true);
  const conflicts = detectConflicts(selected);
  // Per conflict: the category that controls, or '' to let the model balance them.
  const [controls, setControls] = useState<Record<number, string>>({});
  const titleOf = (category: string) => selected.find((r) => r.category === category)?.title ?? category;
  const precedence = conflicts.flatMap((c, i) => {
    const winner = controls[i];
    if (!winner) return [];
    const loser = c.between.find((x) => x !== winner) ?? '';
    return [`Where "${titleOf(winner)}" and "${titleOf(loser)}" pull against each other, "${titleOf(winner)}" takes precedence.`];
  });
  const combined = [buildCombinedInstruction(selected), ...precedence].join('\n');

  // Stated as arithmetic rather than as a promise. "The prior version remains
  // recoverable" is true because artifact_versions is append-only with a
  // trigger enforcing it — nothing is overwritten, so the old number keeps
  // meaning what it meant.
  const current = headVersionNumber ?? 0;
  const versionNote =
    current > 0
      ? `v${current} stays in history — this appends v${current + 1}.`
      : 'This creates the first version of this stage.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-preview-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10"
    >
      <div className="w-full max-w-[680px] rounded-2xl bg-[var(--surface-container)] px-7 py-6 shadow-2xl">
        <h2 id="apply-preview-title" className="text-title text-[var(--on-surface)]">
          Apply {selected.length === 1 ? 'this recommendation' : `these ${selected.length}`} to{' '}
          {stageLabel}
        </h2>

        {/* --- FR-15: selected actions, visible and removable --- */}
        <ul className="mt-4 space-y-2">
          {selected.map((rec) => (
            <li
              key={rec.category}
              className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-body text-[var(--on-surface)]">{rec.title}</p>
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">
                  {describeScope(rec.scope)} · {rec.scope.described_as}
                </p>
              </div>
              <button
                onClick={() => onRemove(rec.category)}
                disabled={applying}
                aria-label={`Remove "${rec.title}" from this revision`}
                className="shrink-0 rounded-lg px-2 py-1 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)] disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {/* --- FR-15: obvious conflicts, non-blocking --- */}
        {conflicts.length > 0 && (
          <div
            role="status"
            className="mt-4 rounded-lg bg-[var(--surface-container-high)] px-4 py-3"
          >
            <p className="text-label uppercase tracking-wider text-[var(--pm-tertiary)]">
              {conflicts.length === 1 ? 'One of these pulls against another' : 'These pull against each other'}
            </p>
            <ul className="mt-1.5 space-y-3">
              {conflicts.map((conflict, i) => (
                <li key={i}>
                  <p className="text-body text-[var(--pm-tertiary)]">{conflict.message}</p>
                  {/* PM-24: ask which should control, rather than leave it to the model. */}
                  <div role="radiogroup" aria-label={`Which should control (${i + 1})`} className="mt-1.5 flex flex-wrap gap-2">
                    {[...conflict.between, ''].map((category) => (
                      <button
                        key={category || 'balance'}
                        role="radio"
                        aria-checked={(controls[i] ?? '') === category}
                        onClick={() => setControls((prev) => ({ ...prev, [i]: category }))}
                        className={`rounded-lg px-3 py-1.5 text-label ${
                          (controls[i] ?? '') === category
                            ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                            : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                        }`}
                      >
                        {category ? `"${titleOf(category)}" controls` : 'Let the model balance them'}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {/* Said out loud, because a warning beside an enabled button
                otherwise reads as a bug. */}
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">
              You can still apply them. Pick which one controls, or let the model balance them.
            </p>
          </div>
        )}

        {/* --- FR-15: the combined instruction, verbatim --- */}
        <div className="mt-5">
          <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            The instruction that will be sent
          </p>
          <pre
            data-testid="combined-instruction"
            className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)]"
          >
            {combined}
          </pre>
          <p className="mt-1.5 text-label text-[var(--on-surface-variant)]">
            This is the text itself, not a summary of it.
          </p>
        </div>

        {/* --- FR-09: the affected scope, and what survives --- */}
        <div className="mt-5 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            Affected scope
          </p>
          <p className="mt-1 text-body text-[var(--on-surface)]" data-testid="affected-scope">
            {selected.length === 1
              ? describeScope(selected[0].scope)
              : `The whole document — ${selected.length} recommendations applied together`}
          </p>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]" data-testid="version-note">
            {versionNote}
          </p>
        </div>

        {error && <p className="mt-4 text-body text-[var(--pm-error)]">{error}</p>}

        <label className="mt-5 flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
          <input
            type="checkbox"
            checked={showFirst}
            onChange={(e) => setShowFirst(e.target.checked)}
            className="h-4 w-4 accent-[var(--pm-primary)]"
          />
          Show the revised version before saving it
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={applying}
            className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply({ showFirst, precedence })}
            // Never disabled by a conflict. Only by there being nothing to do,
            // or by a call already in flight.
            disabled={applying || selected.length === 0}
            className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-label font-medium text-[var(--on-primary)] disabled:opacity-40"
          >
            {applying ? 'Applying…' : selected.length > 1 ? 'Combine and apply' : 'Apply'}
          </button>
        </div>

        <p className="mt-3 text-right text-label text-[var(--on-surface-variant)]">
          One AI pass. Nothing has been sent yet.
        </p>
      </div>
    </div>
  );
}
