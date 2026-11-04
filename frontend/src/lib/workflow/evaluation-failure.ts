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

/**
 * The last completed check of an earlier version, when the version shown has
 * none — or only one that could not run (4 Nov, Sean: an empty or failed
 * result "should preserve the prior valid artifact and evaluation"). Shown
 * labelled with its own version, so it is never read as this version's.
 */
export function lastCompletedCheck<E extends Explained>(
  versions: readonly { id: string; version_number: number }[],
  evaluations: Readonly<Record<string, E>> | undefined,
  shownId: string | undefined
): { evaluation: E; version: number } | null {
  if (!evaluations || !shownId) return null;
  const own = evaluations[shownId];
  if (own && !isFailedEvaluation(own)) return null;
  const shown = versions.find((v) => v.id === shownId);
  if (!shown) return null;
  const earlier = versions
    .filter((v) => v.version_number < shown.version_number && evaluations[v.id] && !isFailedEvaluation(evaluations[v.id]))
    .sort((a, b) => b.version_number - a.version_number)[0];
  return earlier ? { evaluation: evaluations[earlier.id], version: earlier.version_number } : null;
}
