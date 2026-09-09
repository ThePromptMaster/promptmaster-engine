'use client';

/**
 * What a stage evaluation found — FR-11.
 *
 * **This panel got smaller in M4.2, and that was the plan.** It used to carry
 * the corrective recommendation and a "Carry on without it" button, with a
 * docstring promising that M4.2 would own accept / modify / reject / apply and
 * the `recommendations` table. That promise is discharged: the recommendation
 * block now lives in `RecommendationsPanel`, where it can be accepted,
 * applied, deferred or dismissed with a reason, and where it is a durable row
 * rather than React state that vanished on reload.
 *
 * What is left here is the evidence, which is what an evaluation panel should
 * be: the four scores, the incompleteness note, the interpretation bullets and
 * the findings. The panel sits *below* the recommendations for that reason —
 * the recommendations propose, and this is what they rest on.
 *
 * FR-12's four options are now all genuinely available, and none of them are
 * here: accept and modify are the apply preview, reject is Dismiss with a
 * reason, and proceeding without applying is simply not acting — which costs
 * nothing and blocks nothing, exactly as the transition bar stays enabled.
 */

import type { Evaluation } from '@/types/project';

interface Props {
  evaluation: Evaluation | undefined;
}

export function StageEvaluationPanel({ evaluation }: Props) {
  const findings = evaluation?.findings ?? [];
  const interpretation = evaluation?.interpretation ?? null;
  const incomplete = evaluation?.completeness_status === 'incomplete';

  if (!evaluation) return null;

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

      {findings.length === 0 && (
        <p className="mt-4 text-body text-[var(--on-surface-variant)]">
          No specific defects found.
        </p>
      )}
    </section>
  );
}
