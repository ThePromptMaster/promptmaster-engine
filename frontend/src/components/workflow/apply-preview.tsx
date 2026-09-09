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
  onApply: () => void;
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
  const combined = buildCombinedInstruction(selected);
  const conflicts = detectConflicts(selected);

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
            <ul className="mt-1.5 space-y-1">
              {conflicts.map((conflict, i) => (
                <li key={i} className="text-body text-[var(--pm-tertiary)]">
                  {conflict.message}
                </li>
              ))}
            </ul>
            {/* Said out loud, because a warning beside an enabled button
                otherwise reads as a bug. */}
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">
              You can still apply them. Combining them means the model decides which wins.
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

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={applying}
            className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            // Never disabled by a conflict. Only by there being nothing to do,
            // or by a call already in flight.
            disabled={applying || selected.length === 0}
            className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-label font-medium text-[var(--on-primary)] disabled:opacity-40"
          >
            {applying ? 'Applying…' : selected.length > 1 ? 'Combine and apply' : 'Apply'}
          </button>
        </div>

        <p className="mt-3 text-right text-label text-[var(--on-surface-variant)]">
          One model call. Nothing has been sent yet.
        </p>
      </div>
    </div>
  );
}
