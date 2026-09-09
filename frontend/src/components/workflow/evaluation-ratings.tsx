'use client';

/**
 * Each rating, with its explanation, affected area and corrective action.
 *
 * Section 8 of the UX requirements: "Show each rating with explanation,
 * affected area, and corrective action rather than numbers alone." What was
 * here before was numbers alone — one line of three scores, with the stored
 * `alignment_explanation`, `drift_explanation` and `clarity_explanation`
 * rendered nowhere at all.
 *
 * Kept separate from `evaluation-panel.tsx` on purpose. The panel is also
 * where the recommendation block lives, and that block is moving out under a
 * parallel change; confining this to its own file keeps the two edits from
 * landing on the same lines.
 *
 * The arrangement is one card per rating rather than a table. A table implies
 * the four dimensions are commensurable and invites reading across them; they
 * are not — drift's polarity is inverted, and completeness is a status rather
 * than a level. Each card is read on its own terms.
 */

import { ratingDisplay, type RatingRow, type RatingTone } from '@/lib/workflow/evaluation-display';
import type { Evaluation } from '@/types/project';
import type { AuditFinding } from '@/types';

const TONE_TEXT: Record<RatingTone, string> = {
  good: 'text-[var(--pm-success)]',
  bad: 'text-[var(--pm-error)]',
  neutral: 'text-[var(--on-surface)]',
};

export function EvaluationRatings({ evaluation }: { evaluation: Evaluation }) {
  const { rows, otherFindings } = ratingDisplay(evaluation);

  if (rows.length === 0 && otherFindings.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.map((row) => (
        <RatingCard key={row.key} row={row} />
      ))}

      {otherFindings.length > 0 && (
        <div className="rounded-lg bg-[var(--surface-container)] px-4 py-3">
          <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            {otherFindings.length} further finding{otherFindings.length === 1 ? '' : 's'}
          </p>
          {/* Deliberately not filed under a rating. `category` is free text
              from the model, and a finding shown under a dimension it does not
              belong to makes that rating look explained when it is not. */}
          <ul className="mt-2 space-y-2">
            {otherFindings.map((finding) => (
              <li key={finding.id}>
                <OtherFinding finding={finding} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RatingCard({ row }: { row: RatingRow }) {
  return (
    <section
      aria-label={`${row.label} rating`}
      className="rounded-lg bg-[var(--surface-container)] px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {row.label}
        </h4>
        <span className={`text-body font-medium ${TONE_TEXT[row.tone]}`}>{row.value}</span>
        {row.key === 'drift' && (
          <span className="text-label text-[var(--on-surface-variant)]">
            (low is good)
          </span>
        )}
      </div>

      {row.explanation && (
        <p className="mt-1.5 text-body text-[var(--on-surface)]">{row.explanation}</p>
      )}

      {/* A rating with findings has as many affected areas as it has findings,
          each with its own correction. Collapsing them into one sentence is
          precisely the "one corrective action for the whole evaluation" that
          section 8 rules out — so they are listed, tag and all. The category is
          an FR-12 drift axis and is what makes a finding legible. */}
      {row.findings.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {row.findings.map((finding) => (
            <li key={finding.id}>
              {finding.category && (
                <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                  {finding.category}
                </p>
              )}
              <dl className="space-y-1">
                <Field term="Affected area" detail={finding.summary} />
                <Field term="Corrective action" detail={finding.suggested_change} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <dl className="mt-2 space-y-1">
          <Field term="Affected area" detail={row.affected} />
          <Field term="Corrective action" detail={row.corrective} />
        </dl>
      )}
    </section>
  );
}

function Field({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-label text-[var(--on-surface-variant)]">{term}</dt>
      <dd className="min-w-0 flex-1 text-label text-[var(--on-surface)]">{detail}</dd>
    </div>
  );
}

function OtherFinding({ finding }: { finding: AuditFinding }) {
  return (
    <>
      {finding.category && (
        <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {finding.category}
        </p>
      )}
      <p className="text-body text-[var(--on-surface)]">{finding.summary}</p>
      <p className="text-label text-[var(--on-surface-variant)]">{finding.suggested_change}</p>
    </>
  );
}
