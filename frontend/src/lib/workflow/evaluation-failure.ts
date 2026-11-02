/**
 * Whether a stage check is a check that could not run (2 Nov, Sean).
 *
 * The backend's fallback for a failed model call is three Medium scores with
 * no findings — renderable, but it was saved and shown as a check that passed:
 * "No specific defects found", step Done, and Go never ran it again. Results
 * now carry `failed`; rows saved before that are recognised by the fallback's
 * own wording, which every one of its three explanations ends with.
 */
const FALLBACK_SIGNATURE = '(Technical detail:';

type Explained = {
  failed?: boolean | null;
  alignment_explanation?: string | null;
  drift_explanation?: string | null;
  clarity_explanation?: string | null;
  findings?: readonly unknown[] | null;
};

export function isFailedEvaluation(e: Explained | null | undefined): boolean {
  if (!e) return false;
  if (e.failed) return true;
  if (e.findings && e.findings.length > 0) return false;
  const all = [e.alignment_explanation, e.drift_explanation, e.clarity_explanation];
  return all.every((x) => typeof x === 'string' && x.includes(FALLBACK_SIGNATURE));
}

/** The error a failed check is reported as, so every caller's error branch runs. */
export class EvaluationDidNotRun extends Error {
  constructor(message?: string | null) {
    super(message || 'The check could not run. Nothing was lost; run it again.');
    this.name = 'EvaluationDidNotRun';
  }
}
