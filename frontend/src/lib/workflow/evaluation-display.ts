/**
 * Turning a stored evaluation into something a reader can act on.
 *
 * Section 8 of the UX requirements asks for each rating to carry an
 * explanation, an affected area, and a corrective action — "rather than
 * numbers alone". The row this used to render was numbers alone: a single
 * line reading `Alignment High · Clarity Medium · Drift Low`, with the three
 * `*_explanation` columns stored on every evaluation row and displayed
 * nowhere.
 *
 * Three things had to be reconciled to get there:
 *
 * - **The explanations exist already.** `alignment_explanation`,
 *   `drift_explanation` and `clarity_explanation` are written by
 *   `/api/evaluate-stage-artifact` and have never been read. Nothing needed
 *   generating; they needed rendering.
 * - **Corrective action is per-finding, not per-evaluation.** The evaluator
 *   returns one recommendation for the artifact and 0–7 findings, each with
 *   its own `suggested_change`. Attributing findings to the dimension they
 *   speak to is what turns one corrective action for the whole evaluation
 *   into a corrective action per rating.
 * - **Attribution must never invent.** `category` is a free-text tag from the
 *   model, so a finding that matches no dimension is surfaced as an
 *   unattributed finding rather than filed under a rating it does not belong
 *   to. A misfiled finding is worse than an unfiled one: it makes a rating
 *   look explained when it is not.
 *
 * Everything here is pure, and deliberately says nothing about which workflow
 * the evaluation came from.
 */

import type { Evaluation } from '@/types/project';
import type { AuditFinding } from '@/types';

export type RatingKey = 'alignment' | 'clarity' | 'drift' | 'completeness';

export type RatingTone = 'good' | 'bad' | 'neutral';

export interface RatingRow {
  key: RatingKey;
  label: string;
  /** 'High' | 'Medium' | 'Low', or 'complete' | 'incomplete'. */
  value: string | null;
  tone: RatingTone;
  /** The evaluator's one sentence on why this rating. May be empty. */
  explanation: string;
  /** What this rating is a judgment about — specific when findings attribute. */
  affected: string;
  /** What to do about it. */
  corrective: string;
  /** The findings that speak to this dimension. */
  findings: AuditFinding[];
}

export interface RatingDisplay {
  rows: RatingRow[];
  /** Findings whose category matched no dimension. Shown, never filed. */
  otherFindings: AuditFinding[];
}

/**
 * What each dimension is a judgment *about*, when no finding pins it to
 * something narrower.
 *
 * These are the definitions the evaluator was given, not a guess about this
 * artifact — drift's phrasing is FR-12's five axes verbatim, which is what the
 * prompt scores against. Saying "the whole artifact" would be true and
 * useless; saying something specific we did not measure would be false.
 */
const DEFAULT_AREA: Record<RatingKey, string> = {
  alignment: "The artifact as a whole, against this stage's declared intent.",
  clarity: 'How the artifact is structured and worded.',
  drift: 'The objective, audience, constraints, approved outline and current stage.',
  completeness: 'Whether the artifact is structurally finished.',
};

const LABEL: Record<RatingKey, string> = {
  alignment: 'Alignment',
  clarity: 'Clarity',
  drift: 'Drift',
  completeness: 'Completeness',
};

/**
 * Category keywords, tried in this order — first match wins.
 *
 * Ordered most-specific first: 'coverage' is unambiguously completeness, while
 * 'stage' appears in both drift's fifth axis and alignment's definition, so it
 * is left out of both rather than assigned to a coin flip.
 */
const KEYWORDS: ReadonlyArray<readonly [RatingKey, readonly string[]]> = [
  ['completeness', ['complete', 'coverage', 'missing', 'omission', 'gap', 'truncat', 'unfinish']],
  ['drift', ['drift', 'off-topic', 'offtopic', 'irrelevan', 'scope', 'audience', 'constraint', 'outline']],
  ['clarity', ['clarity', 'clear', 'structur', 'readab', 'ambigu', 'wording', 'tone', 'jargon']],
  ['alignment', ['align', 'objective', 'intent', 'brief', 'purpose', 'accuracy', 'evidence']],
];

/** Which dimension a finding speaks to, or null when nothing matches. */
export function findingDimension(finding: AuditFinding): RatingKey | null {
  const tag = (finding.category ?? '').toLowerCase();
  if (!tag.trim()) return null;
  for (const [key, words] of KEYWORDS) {
    if (words.some((w) => tag.includes(w))) return key;
  }
  return null;
}

/**
 * Alignment, clarity and completeness read High-is-good; drift is inverted, so
 * its tone is chosen per dimension rather than per value. Colouring all four by
 * "High = good" would tell a reader their drifting output was fine.
 */
function toneOf(key: RatingKey, value: string | null): RatingTone {
  if (!value) return 'neutral';
  if (key === 'completeness') return value === 'complete' ? 'good' : 'bad';
  const good = key === 'drift' ? 'Low' : 'High';
  const bad = key === 'drift' ? 'High' : 'Low';
  if (value === good) return 'good';
  if (value === bad) return 'bad';
  return 'neutral';
}

function joinSentences(parts: string[]): string {
  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  const unique = [...new Set(cleaned)];
  return unique
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

/**
 * Every rating a stored evaluation can show, with its explanation, the area it
 * covers, and what to do about it.
 *
 * Completeness is included as a fourth row — FR-11 names four dimensions, and
 * `completeness_status` is force-set to `incomplete` when the model hit its
 * token limit, which is the single most actionable thing an evaluation can
 * say. It was previously visible only as a conditional line of prose.
 */
export function ratingDisplay(evaluation: Evaluation): RatingDisplay {
  const findings = evaluation.findings ?? [];

  const byKey: Record<RatingKey, AuditFinding[]> = {
    alignment: [],
    clarity: [],
    drift: [],
    completeness: [],
  };
  const otherFindings: AuditFinding[] = [];

  for (const finding of findings) {
    const key = findingDimension(finding);
    if (key) byKey[key].push(finding);
    else otherFindings.push(finding);
  }

  const raw: Array<{ key: RatingKey; value: string | null; explanation: string }> = [
    {
      key: 'alignment',
      value: evaluation.alignment_score,
      explanation: evaluation.alignment_explanation ?? '',
    },
    {
      key: 'clarity',
      value: evaluation.clarity_score,
      explanation: evaluation.clarity_explanation ?? '',
    },
    {
      key: 'drift',
      value: evaluation.drift_score,
      explanation: evaluation.drift_explanation ?? '',
    },
    {
      key: 'completeness',
      value: evaluation.completeness_status,
      explanation: evaluation.completeness_reason ?? '',
    },
  ];

  const rows: RatingRow[] = raw
    // A dimension an older build never scored is absent, not shown as blank.
    .filter((r) => Boolean(r.value))
    .map(({ key, value, explanation }) => {
      const mine = byKey[key];
      const tone = toneOf(key, value);

      const affected = mine.length
        ? joinSentences(mine.map((f) => f.summary))
        : DEFAULT_AREA[key];

      const corrective = mine.length
        ? joinSentences(mine.map((f) => f.suggested_change))
        : tone === 'good'
          ? 'No change needed.'
          : 'No specific correction was returned for this rating.';

      return {
        key,
        label: LABEL[key],
        value,
        tone,
        explanation: explanation.trim(),
        affected,
        corrective,
        findings: mine,
      };
    });

  return { rows, otherFindings };
}
