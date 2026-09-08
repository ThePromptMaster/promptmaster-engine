'use client';

import type { Evaluation } from '@/types/project';

/**
 * The three scores for the version being viewed.
 *
 * These were shown by the legacy single-output pane and vanished with it. The
 * 65 imported projects carry 128 evaluation rows, and 55 of them sit on their
 * final stage — so the scores are precisely what those users have to look at.
 * Stage generation does not produce new evaluations (`generate-stage-artifact`
 * is one call by design), but stored ones must still be readable.
 *
 * Drift is inverted: Low is the good end. Colouring all three by "High = good"
 * would tell a reader their drifting output was fine, so the tone is chosen per
 * dimension rather than per value.
 */
export function EvaluationScores({ evaluation }: { evaluation: Evaluation | undefined }) {
  if (!evaluation) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Score label="Alignment" value={evaluation.alignment_score} good="High" />
      <Score label="Clarity" value={evaluation.clarity_score} good="High" />
      <Score label="Drift" value={evaluation.drift_score} good="Low" />
      {evaluation.needs_realignment && (
        <span className="rounded-full bg-[var(--error-container)] px-2 py-0.5 text-label text-[var(--on-error-container)]">
          Needs realignment
        </span>
      )}
    </div>
  );
}

function Score({
  label,
  value,
  good,
}: {
  label: string;
  value: string | null;
  good: 'High' | 'Low';
}) {
  if (!value) return null;

  const isGood = value === good;
  const isBad = value === (good === 'High' ? 'Low' : 'High');
  const tone = isGood
    ? 'text-[var(--pm-success,var(--on-surface))]'
    : isBad
      ? 'text-[var(--pm-error,var(--on-surface))]'
      : 'text-[var(--on-surface-variant)]';

  return (
    <span className="text-label text-[var(--on-surface-variant)]">
      {label} <span className={`font-medium ${tone}`}>{value}</span>
    </span>
  );
}
