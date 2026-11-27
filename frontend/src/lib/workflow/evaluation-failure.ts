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

/**
 * Go's re-confirmation of the version shown, after a change (L-317, 27 Nov; Sean,
 * payroll: "the source log says Complete, but v4 says its last check was on v1").
 * A repair re-confirms the stage's approvals against the new version without a
 * full stage check; that is a check of this version, of what it says, and is shown
 * as one, beside the last full check.
 */
export function reconfirmationOf(
  events: readonly { type: string; stage_id: string; reason?: string; payload?: Record<string, unknown>; created_at: string }[],
  stageId: string,
  versionId: string | undefined,
  versions: readonly { id: string; version_number: number }[]
): { version: number; at: string; what: string } | null {
  if (!versionId) return null;
  const version = versions.find((v) => v.id === versionId)?.version_number;
  if (version === undefined) return null;
  const found = [...events]
    .reverse()
    .find((e) => e.type === 'criterion_committed' && e.stage_id === stageId && e.payload?.reconfirmed === true && e.payload?.evidence_version_id === versionId);
  return found ? { version, at: found.created_at, what: (found.reason ?? '').trim() } : null;
}
