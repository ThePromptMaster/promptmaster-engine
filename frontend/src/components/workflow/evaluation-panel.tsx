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

import { EvaluationRatings } from './evaluation-ratings';
import type { Evaluation } from '@/types/project';

interface Props {
  evaluation: Evaluation | undefined;
}

export function StageEvaluationPanel({ evaluation }: Props) {
  const findings = evaluation?.findings ?? [];
  const interpretation = evaluation?.interpretation ?? null;

  if (!evaluation) return null;

  return (
    <section
      aria-label="Stage evaluation"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <h3 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Evaluation
      </h3>

      {/* Section 8: each rating carries its explanation, affected area and
          corrective action. What stood here was the three scores on one line —
          numbers alone, with the stored explanations displayed nowhere.
          Completeness moved in as a fourth rating rather than a conditional
          line of prose below the scores. */}
      {evaluation && (
        <>
          {evaluation.needs_realignment && (
            <p className="mt-2 text-label text-[var(--pm-error)]">Needs realignment</p>
          )}
          {findings.length > 0 && (
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">
              {findings.length} finding{findings.length === 1 ? '' : 's'}, shown against the
              rating each one affects.
            </p>
          )}
          <EvaluationRatings evaluation={evaluation} />
        </>
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

      {/* Findings are no longer listed separately here: each one is shown as
          the corrective action of the rating it speaks to, and the ones that
          match no dimension are grouped by EvaluationRatings. Listing them
          twice made the same sentence read as two different problems. */}

      {findings.length === 0 && (
        <p className="mt-4 text-body text-[var(--on-surface-variant)]">
          No specific defects found.
        </p>
      )}
    </section>
  );
}
