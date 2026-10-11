/**
 * Whether the project's objective is met — as judged, not as reached (6 Oct,
 * email 13: "When a cycle ends with an unmet project objective and a
 * documented blocker, the project should remain blocked or paused, preserve
 * the missing-input requirements, and resume when those inputs arrive").
 *
 * The judgment is `/api/agent/assess-objective`; its result is recorded as a
 * `workflow_events` row `objective_assessed`, and this module reads the
 * latest one back. A later assessment replaces an earlier one; reopening or
 * finishing the project does not erase it.
 */
import type { WorkflowEvent } from './types';

export type BlockerKind = 'data_missing' | 'tool_missing' | 'source_missing' | 'needs_decision';

export interface CriterionResult {
  requirement: string;
  verdict: 'met' | 'not_met' | 'not_checked';
  basis: string;
}

export interface ObjectiveAssessment {
  outcome: 'met' | 'not_met' | 'partly';
  reason: string;
  basis_quote: string;
  blockers: { need: string; kind: BlockerKind }[];
  performed: string[];
  proposed_next: string[];
  /** Each requirement the check considered (10 Oct, email 6.5); absent on older records. */
  criteria?: CriterionResult[];
  /** What was found unmet, by name (11 Oct); absent on older records. */
  unmet?: string[];
  /** The model's own sentence when code overruled its "met" — kept, never shown as the reason. */
  model_note?: string;
}

/**
 * What a check of the objective rested on, as recorded with it (Sean, 10 Oct,
 * emails 3, 5, 8): which saved version was read, each requirement with how it
 * was checked — measured in code, or assessed by the model — and what was not
 * checked at all.
 */
export interface ObjectiveBasis {
  stage_id: string;
  stage_label: string;
  version_id: string | null;
  version_number: number | null;
  measured: string[];
  assessed: CriterionResult[];
  not_checked: string[];
}

/** "Checked Output v3: 2 measured in code, 4 assessed by the model; not verified: fits on one page." */
export function describeBasis(b: ObjectiveBasis): string {
  const where = `${b.stage_label}${b.version_number ? ` v${b.version_number}` : ''}`;
  const met = b.assessed.filter((c) => c.verdict === 'met').length;
  const parts = [
    b.measured.length ? `${b.measured.length} measured in code (${b.measured.join('; ')})` : '',
    met ? `${met} assessed by the AI model against the text` : '',
  ].filter(Boolean);
  const unchecked = b.not_checked.length ? ` Not verified: ${b.not_checked.join('; ')}.` : '';
  return `Checked ${where}${parts.length ? `: ${parts.join(', ')}` : ''}.${unchecked}`;
}

/** The latest assessment in the log, if any. */
export function latestObjectiveAssessment(events: readonly WorkflowEvent[]): (ObjectiveAssessment & { at: string }) | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'objective_assessed') continue;
    const p = (e.payload ?? {}) as Partial<ObjectiveAssessment>;
    if (p.outcome !== 'met' && p.outcome !== 'not_met' && p.outcome !== 'partly') continue;
    return {
      outcome: p.outcome,
      reason: String(p.reason ?? ''),
      basis_quote: String(p.basis_quote ?? ''),
      blockers: Array.isArray(p.blockers) ? p.blockers : [],
      performed: Array.isArray(p.performed) ? p.performed : [],
      proposed_next: Array.isArray(p.proposed_next) ? p.proposed_next : [],
      ...(Array.isArray(p.criteria) ? { criteria: p.criteria } : {}),
      ...(Array.isArray(p.unmet) ? { unmet: p.unmet } : {}),
      at: e.created_at ?? '',
    };
  }
  return null;
}

/**
 * The objective is unmet when the latest assessment says so and nothing the
 * user has done since could have changed that — an edit of the brief, a fact,
 * a file, or a new version of any stage. Those make it "to be checked again",
 * not "met".
 */
export function objectiveUnmet(
  events: readonly WorkflowEvent[],
  facts: readonly { created_at: string }[] = []
): ObjectiveAssessment | null {
  const latest = latestObjectiveAssessment(events);
  if (!latest || latest.outcome === 'met') return null;
  // Until 8 Oct this returned the latest assessment whatever happened after
  // it, so a project kept "waiting for" the launch date and the price after
  // both had been answered (Sean, 7 Oct, email 11).
  const at = Date.parse(latest.at);
  if (Number.isNaN(at)) return latest;
  const after = (iso: string | undefined) => Boolean(iso) && Date.parse(iso!) > at;
  const changed =
    events.some((e) => CHANGES_SINCE.has(e.type) && after(e.created_at)) || facts.some((f) => after(f.created_at));
  return changed ? null : latest;
}

/** What makes an "objective not met" a thing to check again rather than a standing verdict. */
const CHANGES_SINCE = new Set<WorkflowEvent['type']>(['brief_changed', 'stage_version_saved', 'stage_unblocked']);

/** The pause, in words: "Paused — waiting for: the formulas; the data." */
export function pausedLine(a: Pick<ObjectiveAssessment, 'blockers' | 'reason'>): string {
  return a.blockers.length
    ? `Paused — the objective is not met. Waiting for: ${a.blockers.map((b) => b.need).join('; ')}.`
    : /^Not met: /.test(a.reason)
      ? `The objective is not met yet. ${a.reason}`
      : `The objective is not met yet: ${a.reason}`;
}

/**
 * The latest check said "met" on this exact version of the deliverable, and
 * nothing that could change that has happened since: no new version of the
 * deliverable, no change to the brief, no new fact. Judging it again would
 * repeat a model call for the same answer (11 Oct: four checks of an
 * unchanged Output v2 while Go carried on to the end).
 */
export function stillMet(
  events: readonly WorkflowEvent[],
  facts: readonly { created_at: string }[],
  deliverable: { stageId: string; versionId: string | null }
): (ObjectiveAssessment & { at: string; basis: ObjectiveBasis }) | null {
  const latest = latestObjectiveAssessment(events);
  if (!latest || latest.outcome !== 'met' || !deliverable.versionId) return null;
  const assessed = [...events].reverse().find((e) => e.type === 'objective_assessed');
  const basis = (assessed?.payload as { basis?: ObjectiveBasis } | undefined)?.basis;
  if (basis?.version_id !== deliverable.versionId) return null;
  const at = Date.parse(latest.at);
  if (Number.isNaN(at)) return null;
  const after = (iso: string | undefined) => Boolean(iso) && Date.parse(iso!) > at;
  const changed = events.some(
    (e) => after(e.created_at) && (e.type === 'brief_changed' || (e.type === 'stage_version_saved' && e.stage_id === deliverable.stageId))
  );
  return changed || facts.some((f) => after(f.created_at)) || !basis ? null : { ...latest, basis };
}
