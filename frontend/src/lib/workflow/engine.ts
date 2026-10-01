/**
 * The workflow engine: pure functions over a template and project state.
 *
 * No I/O, no model calls, no React. Everything here is deterministic, which is
 * what lets exit criteria be trustworthy — a gate that sometimes fails because
 * a network call timed out is a gate users learn to resent.
 */

import type {
  CriterionResult,
  ExitCriterion,
  StageContext,
  StageDefinition,
  StageEvaluation,
  StageState,
  WorkflowEvent,
  WorkflowState,
  WorkflowTemplate,
} from './types';
import { isDone } from './types';

export function getStage(
  template: WorkflowTemplate,
  stageId: string
): StageDefinition | undefined {
  return template.stages.find((s) => s.id === stageId);
}

// --- exit criteria ----------------------------------------------------------

/** Renderers whose artifact is a list of items that count rules can count. */
const COUNTABLE_RENDERERS = new Set(['list', 'review', 'outline']);

function evaluateCriterion(
  criterion: ExitCriterion,
  stageId: string,
  ctx: StageContext,
  renderer?: string
): CriterionResult {
  const base = {
    id: criterion.id,
    label: criterion.label,
    blocking: criterion.blocking ?? false,
    ...(criterion.hint ? { hint: criterion.hint } : {}),
  };

  const manual = { ...base, manual: true, satisfied: Boolean(ctx.manualChecks[criterion.id]) };

  if (criterion.check === 'manual') return manual;

  const rule = criterion.rule;
  if (!rule) {
    // An auto criterion with no rule is a template authoring mistake. Degrade
    // to a manual checklist item rather than throwing: an admin editing a
    // template should get a checkbox, not a broken workflow.
    return { ...manual, degraded: true };
  }

  // A count rule on a stage with nothing to count — Book's "at least two
  // comparables" on the prose Positioning stage (PM-02) — can never be met by
  // anything the user does. Same degradation: let them tick it.
  if (
    (rule.type === 'min_items' || rule.type === 'every_item_has_status' || rule.type === 'every_item_has_fields' || rule.type === 'min_items_with_status') &&
    renderer !== undefined &&
    !COUNTABLE_RENDERERS.has(renderer)
  ) {
    return { ...manual, degraded: true, detail: manual.satisfied ? undefined : 'tick when the draft covers it' };
  }

  // Revision's "Accepted findings applied": the findings live on the review
  // stage before it, so on the long-form stage itself there are none, and the
  // rule read as satisfied before anything had been applied. Tick it instead.
  if (rule.type === 'all_findings_triaged' && renderer === 'long_form') {
    return { ...manual, degraded: true, detail: manual.satisfied ? undefined : 'tick once the findings are applied' };
  }

  switch (rule.type) {
    case 'artifact_non_empty':
      return { ...base, satisfied: Boolean(ctx.artifactNonEmpty[stageId]) };

    case 'field_non_empty':
      return { ...base, satisfied: (ctx.fields[rule.field] ?? '').trim().length > 0 };

    case 'min_items': {
      const have = ctx.itemCounts[stageId] ?? 0;
      return {
        ...base,
        satisfied: have >= rule.n,
        detail: have >= rule.n ? undefined : `${have} of ${rule.n}`,
      };
    }

    case 'all_sections_complete': {
      const { complete: done, total } = ctx.sections[stageId] ?? { total: 0, complete: 0 };
      return {
        ...base,
        // Zero sections is not "all complete" — it means drafting hasn't started.
        satisfied: total > 0 && done >= total,
        detail: total === 0 ? 'no sections yet' : done >= total ? undefined : `${done} of ${total}`,
      };
    }

    case 'every_item_has_status': {
      const missing = ctx.itemsMissingStatus[stageId] ?? 0;
      // A table that has not been drafted yet has no rows to be undecided,
      // and read as "done · ready to move on" while it was still being
      // written (production pass, 2026-10-01). A drafted table with no rows
      // is a different thing and stays a valid, finished answer.
      const drafted = ctx.artifactNonEmpty[stageId] === true;
      return {
        ...base,
        satisfied: drafted && missing === 0,
        detail: !drafted ? 'nothing drafted yet' : missing === 0 ? undefined : `${missing} still unresolved`,
      };
    }

    // What PromptMaster can see for itself it should not ask the user to
    // vouch for: "each has a prediction and a disconfirmer" was a box to tick
    // on a table whose rows already had both columns (1 Oct, item 6).
    case 'every_item_has_fields': {
      const have = ctx.itemCounts[stageId] ?? 0;
      const gaps = ctx.itemFieldGaps?.[stageId] ?? {};
      const short = rule.fields.map((f) => gaps[f] ?? 0).reduce((a, b) => Math.max(a, b), 0);
      return {
        ...base,
        satisfied: have > 0 && short === 0,
        detail: have === 0 ? 'nothing to check yet' : short === 0 ? undefined : `${short} of ${have} incomplete`,
      };
    }

    // Three works named is not three works established (1 Oct, item 12).
    case 'min_items_with_status': {
      const counts = ctx.itemStatusCounts?.[stageId] ?? {};
      const have = rule.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
      return { ...base, satisfied: have >= rule.n, detail: have >= rule.n ? undefined : `${have} of ${rule.n}` };
    }

    case 'outline_approved':
      return { ...base, satisfied: ctx.outlineApproved };

    case 'all_findings_triaged': {
      const held = ctx.findings[stageId] ?? { total: 0, triaged: 0 };
      const outstanding = held.total - held.triaged;
      return {
        ...base,
        satisfied: outstanding <= 0,
        detail: outstanding <= 0 ? undefined : `${outstanding} untriaged`,
      };
    }

    default: {
      // An unrecognised rule type — an admin added one this build predates.
      // Degrade to a manual check rather than a 500.
      const unknown = rule as { type: string };
      return { ...manual, degraded: true, label: `Manual check: ${unknown.type}` };
    }
  }
}

export function evaluateStage(
  template: WorkflowTemplate,
  stageId: string,
  ctx: StageContext
): StageEvaluation {
  const stage = getStage(template, stageId);
  if (!stage) {
    return { stageId, criteria: [], canAdvance: true, unmet: [] };
  }

  const criteria = stage.exit_criteria.map((c) => evaluateCriterion(c, stageId, ctx, stage.renderer));
  const unmet = criteria.filter((c) => !c.satisfied);
  return {
    stageId,
    criteria,
    unmet,
    // Only blocking criteria gate the happy path. Everything else is advice.
    canAdvance: unmet.every((c) => !c.blocking),
  };
}

// --- navigation -------------------------------------------------------------

export function nextSuggestedStage(
  template: WorkflowTemplate,
  state: WorkflowState
): string | null {
  const current = getStage(template, state.current_stage_id);
  if (current?.transitions.default_next) return current.transitions.default_next;

  // Fall back to the first stage that has not been dealt with, so a user who
  // jumped around still gets a sensible suggestion.
  const pending = template.stages.find((s) => {
    const status = state.stages[s.id]?.status ?? 'not_started';
    return s.required && !isDone(status) && status !== 'skipped';
  });
  return pending?.id ?? null;
}

export interface TransitionOption {
  kind: 'advance' | 'skip' | 'return' | 'finish';
  toStageId: string | null;
  label: string;
  /** True when a criterion is unmet — the UI relabels to "Advance anyway". */
  requiresNote: boolean;
}

export function availableTransitions(
  template: WorkflowTemplate,
  state: WorkflowState,
  evaluation: StageEvaluation
): TransitionOption[] {
  const stage = getStage(template, state.current_stage_id);
  if (!stage) return [];

  const options: TransitionOption[] = [];
  const next = stage.transitions.default_next;

  if (next) {
    options.push({
      kind: 'advance',
      toStageId: next,
      label: evaluation.canAdvance ? 'Advance' : 'Advance anyway',
      requiresNote: !evaluation.canAdvance,
    });
  } else {
    // Same rule as advancing: finishing past an unmet blocking criterion is
    // allowed, but it is a deviation, so it is named and asks why.
    options.push({
      kind: 'finish',
      toStageId: null,
      label: evaluation.canAdvance ? 'Finish' : 'Finish anyway',
      requiresNote: !evaluation.canAdvance,
    });
  }

  if (stage.transitions.allow_skip && next) {
    options.push({ kind: 'skip', toStageId: next, label: 'Skip this stage', requiresNote: true });
  }

  for (const id of stage.transitions.allow_return_to) {
    const target = getStage(template, id);
    if (target) {
      options.push({
        kind: 'return',
        toStageId: id,
        label: `Return to ${target.short_label}`,
        requiresNote: false,
      });
    }
  }

  return options;
}

// --- projection -------------------------------------------------------------

/**
 * The state a project starts from before any event is replayed.
 *
 * `resumeStageId` exists for a project whose event log is empty but which is
 * demonstrably not at the beginning — every project imported from /session is
 * exactly that: `projects.stage` records where the user got to, and no
 * `workflow_events` row was ever written for them. Without it, sixty-five
 * imported projects open on stage one with their finished output a click away
 * in the rail, which reads as data loss.
 *
 * It moves the cursor and nothing else. Earlier stages stay `not_started`
 * rather than being back-filled as `complete`: we know where the user was, and
 * inventing completions they never recorded would put fiction in the one place
 * the app treats as the record.
 */
export function initialState(
  template: WorkflowTemplate,
  resumeStageId?: string | null
): WorkflowState {
  const resume = resumeStageId ? getStage(template, resumeStageId) : undefined;
  const start = resume ?? template.stages[0];
  return {
    current_stage_id: start?.id ?? '',
    stages: start ? { [start.id]: { status: 'in_progress' } } : {},
  };
}

/**
 * Rebuild workflow state from the event log.
 *
 * Events are the record; state is a projection. Deriving it in exactly one
 * place is what makes that true by construction rather than by everyone
 * remembering to keep two things in sync.
 */
export function projectState(
  template: WorkflowTemplate,
  events: WorkflowEvent[],
  /**
   * Where to start when there is nothing to replay — `projects.stage`, the
   * denormalised cursor. Ignored the moment a single event exists, because
   * from then on the log is the record and a cursor that disagrees with it is
   * stale by definition.
   */
  resumeStageId?: string | null
): WorkflowState {
  const state = initialState(template, events.length === 0 ? resumeStageId : undefined);
  const order = template.stages.map((s) => s.id);

  const set = (id: string, patch: Partial<StageState>) => {
    state.stages[id] = { ...(state.stages[id] ?? { status: 'not_started' }), ...patch };
  };

  for (const event of events) {
    switch (event.type) {
      case 'stage_entered':
        set(event.stage_id, { status: 'in_progress', entered_at: event.created_at });
        state.current_stage_id = event.stage_id;
        break;

      // Legacy: every log written before PM-13 projects exactly as it did.
      case 'stage_completed':
        set(event.stage_id, { status: 'complete', completed_at: event.created_at, left_open: false });
        if (event.to_stage_id) {
          set(event.to_stage_id, { status: 'in_progress', entered_at: event.created_at });
          state.current_stage_id = event.to_stage_id;
        }
        break;

      case 'stage_marked_complete': {
        const evidence = event.payload?.evidence_version_id;
        // C5: closing a reopened stage on different evidence than before
        // means the work after it was built on something else. Mark that
        // work stale (the rail's "recheck"), never delete it — derived from
        // the events alone, no timestamps.
        // The same holds for a stage that was left open and is closed later
        // on a different version than it was left with: the stages after it
        // were written against the earlier one (1 Oct, item 1: "if an
        // upstream decision changes, anything downstream that may have been
        // affected should be flagged for recheck"). Closing it by ticking a
        // box, on the version it was left with, flags nothing.
        const prior = state.stages[event.stage_id];
        const before = prior?.evidence_version_id ?? prior?.left_version_id;
        if (!event.to_stage_id && typeof evidence === 'string' && before && before !== evidence) {
          const cutoff = order.indexOf(event.stage_id);
          order.forEach((id, i) => {
            if (i > cutoff && isDone(state.stages[id]?.status)) set(id, { status: 'stale' });
          });
        }
        set(event.stage_id, {
          status: typeof evidence === 'string' ? 'completed_with_artifact' : 'complete',
          evidence_version_id: typeof evidence === 'string' ? evidence : undefined,
          completed_at: event.created_at,
          left_open: false,
          blocked: undefined,
        });
        if (event.to_stage_id) {
          set(event.to_stage_id, { status: 'in_progress', entered_at: event.created_at });
          state.current_stage_id = event.to_stage_id;
        }
        break;
      }

      // Moving on is not finishing (PM-13): the stage stays in progress,
      // flagged as left open, and says so on the rail.
      case 'stage_advanced': {
        const left = event.payload?.left_version_id;
        set(event.stage_id, {
          status: 'in_progress', left_open: true,
          ...(typeof left === 'string' ? { left_version_id: left } : {}),
          ...(event.reason ? { left_reason: event.reason } : {}),
        });
        if (event.to_stage_id) {
          set(event.to_stage_id, { status: 'in_progress', entered_at: event.created_at });
          state.current_stage_id = event.to_stage_id;
        }
        break;
      }

      case 'stage_blocked': {
        const kind = event.payload?.block_kind;
        set(event.stage_id, {
          status: 'blocked',
          blocked: {
            kind: kind === 'tool_missing' || kind === 'data_missing' ? kind : 'needs_decision',
            reason: event.reason ?? '',
          },
        });
        break;
      }

      case 'stage_unblocked':
        set(event.stage_id, { status: 'in_progress', blocked: undefined });
        break;

      // C5: back to in progress, cursor unmoved, earlier evidence remembered
      // so that closing it again on new evidence can flag the work after it.
      case 'stage_reopened':
        set(event.stage_id, { status: 'in_progress', left_open: false, blocked: undefined });
        break;

      case 'project_finalized':
        state.project_status = 'finalized';
        break;

      case 'project_reopened':
        state.project_status = 'active';
        break;

      case 'stage_skipped':
        set(event.stage_id, { status: 'skipped', skipped_reason: event.reason });
        if (event.to_stage_id) {
          set(event.to_stage_id, { status: 'in_progress', entered_at: event.created_at });
          state.current_stage_id = event.to_stage_id;
        }
        break;

      case 'stage_returned': {
        const target = event.to_stage_id ?? event.stage_id;
        // Work after the point returned to is marked stale, never deleted —
        // the user may well keep it.
        const cutoff = order.indexOf(target);
        order.forEach((id, i) => {
          if (i > cutoff && isDone(state.stages[id]?.status)) {
            set(id, { status: 'stale' });
          }
        });
        set(target, { status: 'in_progress', entered_at: event.created_at });
        state.current_stage_id = target;
        break;
      }

      default:
        // Content events (outline_approved, section_written, job_*) belong on
        // the timeline but do not move the cursor.
        break;
    }
  }

  return state;
}

/**
 * A left-open stage — moved past with requirements still open (PM-13) — is
 * neither done nor ahead. Counting it as "to go" made a finished Book read
 * "12 done · 1 to go" (Sean, 28 Sep, item 20: Positioning). It is reported on
 * its own so the caption can say what it is.
 */
export function progressSummary(template: WorkflowTemplate, state: WorkflowState) {
  let complete = 0;
  let skipped = 0;
  let leftOpen = 0;
  for (const stage of template.stages) {
    const st = state.stages[stage.id];
    const status = st?.status;
    if (isDone(status)) complete += 1;
    else if (status === 'skipped') skipped += 1;
    else if (status === 'in_progress' && st?.left_open) leftOpen += 1;
  }
  return {
    complete,
    skipped,
    leftOpen,
    remaining: template.stages.length - complete - skipped - leftOpen,
    total: template.stages.length,
  };
}

/** Stages moved past with requirements still open, in workflow order. */
export function leftOpenStages(template: WorkflowTemplate, state: WorkflowState): StageDefinition[] {
  return template.stages.filter((s) => {
    const st = state.stages[s.id];
    return st?.status === 'in_progress' && Boolean(st.left_open);
  });
}

/**
 * Does ticking a box close a stage that was left open?
 *
 * A stage moved past with a required box unticked stayed open for good: the
 * only "Mark complete" lived on the current stage's menu, and ticking the box
 * later recorded the tick and nothing else. Once the last blocking requirement
 * of a left-open stage is met, the tick is the user declaring it done, and the
 * caller writes `stage_marked_complete` (actor 'user') without moving the
 * cursor. Pure: the caller passes the context as it will be after the tick.
 */
export function tickClosesStage(
  template: WorkflowTemplate,
  state: WorkflowState,
  stageId: string,
  ctxAfterTick: StageContext
): boolean {
  const st = state.stages[stageId];
  if (!st || st.status !== 'in_progress' || !st.left_open) return false;
  return evaluateStage(template, stageId, ctxAfterTick).canAdvance;
}

// --- project completion (PM-14) ------------------------------------------------

/**
 * The stage that holds what the project exists to produce.
 *
 * Sean: "Project completion should depend on the actual objective/artifact
 * being completed, not just every workflow stage being checked off." In a
 * workflow with long-form drafting the deliverable is the manuscript, which
 * lives on the first long-form stage (revision and editing work on it too);
 * otherwise it is the last required prose stage — Single output's Output, not
 * its optional Realign.
 */
export function deliverableStage(template: WorkflowTemplate): StageDefinition | undefined {
  const longForm = template.stages.find((s) => s.renderer === 'long_form');
  if (longForm) return longForm;
  return [...template.stages].reverse().find((s) => s.required && s.renderer === 'prose');
}

/** Is the deliverable itself done? For a manuscript, every section; otherwise a non-empty draft. */
export function deliverableDone(
  stage: StageDefinition,
  ctx: Pick<StageContext, 'artifactNonEmpty' | 'sections'>
): boolean {
  if (stage.renderer === 'long_form') {
    const { total, complete } = ctx.sections[stage.id] ?? { total: 0, complete: 0 };
    return total > 0 && complete >= total;
  }
  return Boolean(ctx.artifactNonEmpty[stage.id]);
}

export interface CompletionSummary {
  deliverable: StageDefinition | undefined;
  deliverableDone: boolean;
  completed: number;
  withArtifact: number;
  skipped: number;
  leftOpen: number;
  /** The left-open stages by name, so Finish can say which, not just how many. */
  leftOpenStages: StageDefinition[];
  blocked: number;
  notStarted: number;
}

/**
 * What finishing the project would be finishing. `deliverableDone` is the
 * question that matters; the counts are context, not a gate.
 */
export function completionSummary(
  template: WorkflowTemplate,
  state: WorkflowState,
  ctx: Pick<StageContext, 'artifactNonEmpty' | 'sections'>
): CompletionSummary {
  const stage = deliverableStage(template);
  const done = stage ? deliverableDone(stage, ctx) : false;

  const summary: CompletionSummary = {
    deliverable: stage,
    deliverableDone: done,
    completed: 0,
    withArtifact: 0,
    skipped: 0,
    leftOpen: 0,
    leftOpenStages: leftOpenStages(template, state),
    blocked: 0,
    notStarted: 0,
  };
  for (const s of template.stages) {
    const st = state.stages[s.id];
    const status = st?.status ?? 'not_started';
    if (isDone(status)) summary.completed += 1;
    if (status === 'completed_with_artifact') summary.withArtifact += 1;
    if (status === 'skipped') summary.skipped += 1;
    if (status === 'blocked') summary.blocked += 1;
    if (status === 'not_started') summary.notStarted += 1;
    if (st?.left_open && status === 'in_progress') summary.leftOpen += 1;
  }
  return summary;
}
