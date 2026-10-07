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

export interface ObjectiveAssessment {
  outcome: 'met' | 'not_met' | 'partly';
  reason: string;
  basis_quote: string;
  blockers: { need: string; kind: BlockerKind }[];
  performed: string[];
  proposed_next: string[];
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
export function objectiveUnmet(events: readonly WorkflowEvent[]): ObjectiveAssessment | null {
  const latest = latestObjectiveAssessment(events);
  if (!latest || latest.outcome === 'met') return null;
  return latest;
}

/** The pause, in words: "Paused — waiting for: the formulas; the data." */
export function pausedLine(a: Pick<ObjectiveAssessment, 'blockers' | 'reason'>): string {
  return a.blockers.length
    ? `Paused — the objective is not met. Waiting for: ${a.blockers.map((b) => b.need).join('; ')}.`
    : `The objective is not met yet: ${a.reason}`;
}
