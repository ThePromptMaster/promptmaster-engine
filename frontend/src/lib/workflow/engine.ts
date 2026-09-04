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

export function getStage(
  template: WorkflowTemplate,
  stageId: string
): StageDefinition | undefined {
  return template.stages.find((s) => s.id === stageId);
}

// --- exit criteria ----------------------------------------------------------

function evaluateCriterion(
  criterion: ExitCriterion,
  stageId: string,
  ctx: StageContext
): CriterionResult {
  const base = {
    id: criterion.id,
    label: criterion.label,
    blocking: criterion.blocking ?? false,
  };

  if (criterion.check === 'manual') {
    return { ...base, satisfied: Boolean(ctx.manualChecks[criterion.id]) };
  }

  const rule = criterion.rule;
  if (!rule) {
    // An auto criterion with no rule is a template authoring mistake. Degrade
    // to a manual checklist item rather than throwing: an admin editing a
    // template should get a checkbox, not a broken workflow.
    return { ...base, satisfied: Boolean(ctx.manualChecks[criterion.id]) };
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
      const { sectionsComplete: done, sectionsTotal: total } = ctx;
      return {
        ...base,
        // Zero sections is not "all complete" — it means drafting hasn't started.
        satisfied: total > 0 && done >= total,
        detail: total === 0 ? 'no sections yet' : done >= total ? undefined : `${done} of ${total}`,
      };
    }

    case 'every_item_has_status': {
      const missing = ctx.itemsMissingStatus[stageId] ?? 0;
      return {
        ...base,
        satisfied: missing === 0,
        detail: missing === 0 ? undefined : `${missing} still unresolved`,
      };
    }

    case 'outline_approved':
      return { ...base, satisfied: ctx.outlineApproved };

    case 'all_findings_triaged': {
      const outstanding = ctx.findingsTotal - ctx.findingsTriaged;
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
      return {
        ...base,
        label: `Manual check: ${unknown.type}`,
        satisfied: Boolean(ctx.manualChecks[criterion.id]),
      };
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

  const criteria = stage.exit_criteria.map((c) => evaluateCriterion(c, stageId, ctx));
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
    return s.required && status !== 'complete' && status !== 'skipped';
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
    options.push({ kind: 'finish', toStageId: null, label: 'Finish', requiresNote: false });
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

export function initialState(template: WorkflowTemplate): WorkflowState {
  const first = template.stages[0];
  return {
    current_stage_id: first?.id ?? '',
    stages: first ? { [first.id]: { status: 'in_progress' } } : {},
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
  events: WorkflowEvent[]
): WorkflowState {
  const state = initialState(template);
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

      case 'stage_completed':
        set(event.stage_id, { status: 'complete', completed_at: event.created_at });
        if (event.to_stage_id) {
          set(event.to_stage_id, { status: 'in_progress', entered_at: event.created_at });
          state.current_stage_id = event.to_stage_id;
        }
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
          if (i > cutoff && state.stages[id]?.status === 'complete') {
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

export function progressSummary(template: WorkflowTemplate, state: WorkflowState) {
  let complete = 0;
  let skipped = 0;
  for (const stage of template.stages) {
    const status = state.stages[stage.id]?.status;
    if (status === 'complete') complete += 1;
    else if (status === 'skipped') skipped += 1;
  }
  return {
    complete,
    skipped,
    remaining: template.stages.length - complete - skipped,
    total: template.stages.length,
  };
}
