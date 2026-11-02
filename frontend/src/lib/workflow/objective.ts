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
  /** `ask`: one question that would supply it (13 Oct, workshop); absent on older records. */
  blockers: { need: string; kind: BlockerKind; ask?: string }[];
  performed: string[];
  proposed_next: string[];
  /** Each requirement the check considered (10 Oct, email 6.5); absent on older records. */
  criteria?: CriterionResult[];
  /** What was found unmet, by name (11 Oct); absent on older records. */
  unmet?: string[];
  /** The model's own sentence when code overruled its "met" — kept, never shown as the reason. */
  model_note?: string;
  /** Gaps the brief allows to remain, with its words that allow them (19 Oct, HARBOR). */
  limitations?: { item: string; allowed_by: string }[];
  /** A round check: nothing is left for the user; the next stage writes the deliverable. */
  ready_for_later_stage?: boolean;
  /**
   * The next task PromptMaster itself can carry out (25 Oct). `needs` names
   * the blockers it waits on; empty means it can be done now, whatever else
   * is missing.
   */
  next_task?: NextTask | null;
}

export interface NextTask {
  title: string;
  kind: 'write' | 'list' | 'check';
  work: string;
  needs: string[];
}

/**
 * The next task, when nothing it needs is missing (25 Oct, Sean: "An
 * unfinished overall objective shouldn't block executable work. Missing
 * dependencies should block only the tasks that require them").
 */
export function executableNext(a: Pick<ObjectiveAssessment, 'outcome' | 'next_task'> | null | undefined): NextTask | null {
  const t = a?.next_task;
  if (!a || a.outcome === 'met' || !t || !t.title?.trim()) return null;
  return t.needs?.length ? null : t;
}

/** "Objective still open — next: …", with what waits only on other work. */
export function openWithNextLine(a: Pick<ObjectiveAssessment, 'blockers'>, next: NextTask): string {
  const waiting = a.blockers.map((b) => b.need.replace(/[.\s]+$/, ''));
  return `The objective is still open; the next task can be done now: ${next.title}.` +
    (waiting.length ? ` Missing, but not needed for it: ${waiting.join('; ')}.` : '');
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
  /** The deliverable check's finding in counts (1 Nov, `lib/agent/deliverable-check.ts`). */
  check?: string;
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
  return `Checked ${where}${parts.length ? `: ${parts.join(', ')}` : ''}.${unchecked}${b.check ? ` ${b.check}` : ''}`;
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
      // 20 Oct (prod pass): recorded since #330, but not read back, so the
      // pause card never showed what was carried as a limitation.
      ...(Array.isArray(p.limitations) ? { limitations: p.limitations } : {}),
      ...(p.ready_for_later_stage ? { ready_for_later_stage: true } : {}),
      ...(p.next_task && typeof p.next_task === 'object' ? { next_task: p.next_task } : {}),
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
  // A round check that found nothing left for the user moved the work on to
  // the stage that writes the deliverable: it is not a pause (20 Oct, prod
  // pass: "The objective is not met yet" and "Resume Go" stood beside a Go
  // waiting only for the package's approval).
  if (latest.ready_for_later_stage) return null;
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
export const OBJECTIVE_CHANGES = ['brief_changed', 'stage_version_saved', 'stage_unblocked', 'stage_added'] as const satisfies readonly WorkflowEvent['type'][];
const CHANGES_SINCE = new Set<WorkflowEvent['type']>(OBJECTIVE_CHANGES);

/** A Go stop reason that is the objective check's pause (`pausedLine`). */
const OBJECTIVE_STOP = /\bobjective is not met\b/i;

/**
 * What "Go is waiting for you" says, beside the objective's own item (13 Oct,
 * Sean, workshop): nothing while the objective's item says the same thing,
 * and only "resume" once a change has made the check it stopped on out of
 * date — never the old blocker after it was resolved.
 */
export function goWaitingLine(stopReason: string | null, objectiveOpen: boolean): string | null {
  if (!stopReason || !OBJECTIVE_STOP.test(stopReason)) return stopReason;
  return objectiveOpen ? null : 'resume Go to check the objective again';
}

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
