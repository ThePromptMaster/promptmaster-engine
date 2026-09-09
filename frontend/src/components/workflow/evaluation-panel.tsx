'use client';

/**
 * What a stage evaluation found — FR-11, minimally.
 *
 * Deliberately not the recommendations surface. M4.2 owns accept / modify /
 * reject / apply and the `recommendations` table; this panel exists so the
 * findings that M4.1 now persists are *visible*, and so the corrective
 * recommendation the same call produced is not thrown away silently between
 * being returned and being renderable.
 *
 * The one interaction here is Dismiss, which clears the recommendation from
 * view and nothing else. FR-12 says a user "may accept, modify, reject, or
 * proceed without applying it" — proceeding without applying is the only one
 * of the four this milestone can honestly offer, so it is the only one shown.
 */

import type { Evaluation } from '@/types/project';
import type { StageRecommendation } from '@/types';

interface Props {
  evaluation: Evaluation | undefined;
  recommendation: StageRecommendation | null;
  onDismissRecommendation: () => void;
}

export function StageEvaluationPanel({
  evaluation,
  recommendation,
  onDismissRecommendation,
}: Props) {
  const findings = evaluation?.findings ?? [];
  const interpretation = evaluation?.interpretation ?? null;
  const incomplete = evaluation?.completeness_status === 'incomplete';

  if (!evaluation && !recommendation) return null;

  return (
    <section
      aria-label="Stage evaluation"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <h3 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Evaluation
      </h3>

      {evaluation && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          Alignment {evaluation.alignment_score} · Clarity {evaluation.clarity_score} · Drift{' '}
          {evaluation.drift_score}
          {evaluation.needs_realignment && ' · needs realignment'}
        </p>
      )}

      {incomplete && evaluation?.completeness_reason && (
        <p className="mt-2 text-body text-[var(--pm-tertiary)]">
          Incomplete: {evaluation.completeness_reason}
        </p>
      )}

      {interpretation && interpretation.bullets.length > 0 && (
        <div className="mt-4">
          <p className="text-label text-[var(--on-surface-variant)]">{interpretation.label}</p>
          <ul className="mt-1 space-y-1">
            {interpretation.bullets.map((bullet, i) => (
              <li key={i} className="text-body text-[var(--on-surface)]">
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      )}

      {findings.length > 0 && (
        <div className="mt-4">
          <p className="text-label text-[var(--on-surface-variant)]">
            {findings.length} finding{findings.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 space-y-3">
            {findings.map((finding) => (
              <li key={finding.id}>
                <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                  {finding.category}
                </p>
                <p className="text-body text-[var(--on-surface)]">{finding.summary}</p>
                <p className="text-body text-[var(--on-surface-variant)]">
                  {finding.suggested_change}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation && findings.length === 0 && (
        <p className="mt-4 text-body text-[var(--on-surface-variant)]">
          No specific defects found.
        </p>
      )}

      {recommendation && (
        <div className="mt-5 rounded-lg bg-[var(--surface-container-high)] px-4 py-3">
          <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            Suggested correction
          </p>
          <p className="mt-1 text-body text-[var(--on-surface)]">{recommendation.title}</p>
          {recommendation.triggering_issue && (
            <p className="mt-1 text-body text-[var(--on-surface-variant)]">
              Because: {recommendation.triggering_issue}
            </p>
          )}
          {recommendation.expected_benefit && (
            <p className="text-body text-[var(--on-surface-variant)]">
              Would give you: {recommendation.expected_benefit}
            </p>
          )}
          {recommendation.scope && (
            <p className="text-body text-[var(--on-surface-variant)]">
              Affects: {recommendation.scope}
            </p>
          )}
          <button
            onClick={onDismissRecommendation}
            className="mt-3 rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
          >
            Carry on without it
          </button>
        </div>
      )}
    </section>
  );
}
