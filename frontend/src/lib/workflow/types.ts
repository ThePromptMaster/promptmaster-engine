/**
 * Declarative workflow templates (FR-03).
 *
 * A workflow is DATA, not a code path. Book and Research must run through the
 * same engine and the same components; if either one needs a branch that says
 * `if (workflow === 'book')`, this design has failed.
 *
 * The test of that: 26 stages across two templates, five renderers, zero
 * workflow-specific components.
 */

import type { ModeType } from '@/types';

/**
 * The closed vocabulary FR-04 requires the UI to distinguish: "long-form work
 * visibly distinguishes planning, outlining, drafting, expansion, evaluation,
 * revision and final review". The stage rail groups and colours by this, which
 * is how one component renders both workflows legibly.
 */
export type StageGroup =
  | 'planning'
  | 'outlining'
  | 'drafting'
  | 'expansion'
  | 'evaluation'
  | 'revision'
  | 'final_review';

/**
 * How a stage's artifact is edited. Five renderers cover both workflows —
 * Book's fact-checking table and Research's reproduction table are literally
 * the same component with different columns, which is the sharpest evidence
 * that the engine is genuinely shared.
 */
export type StageRenderer = 'prose' | 'list' | 'outline' | 'long_form' | 'review';

/**
 * Exit criteria are declarative predicates, never functions.
 *
 * Deliberately excludes anything requiring an LLM call: an exit criterion that
 * depends on a model is an exit criterion that fails at 3am, and blocks a user
 * from advancing for reasons they cannot see or fix.
 */
export type AutoRule =
  | { type: 'artifact_non_empty' }
  | { type: 'min_items'; n: number }
  | { type: 'all_sections_complete' }
  | { type: 'every_item_has_status' }
  /** At least n rows carry one of these statuses — "three works retrieved or verified". */
  | { type: 'min_items_with_status'; n: number; statuses: string[] }
  /** Every row fills these fields — "each hypothesis has a prediction and a disconfirmer". */
  | { type: 'every_item_has_fields'; fields: string[] }
  | { type: 'outline_approved' }
  | { type: 'all_findings_triaged' }
  | { type: 'field_non_empty'; field: string };

export interface ExitCriterion {
  id: string;
  label: string;
  /** 'manual' criteria are user-ticked; 'auto' are computed from project state. */
  check: 'auto' | 'manual';
  rule?: AutoRule;
  /**
   * Unmet blocking criteria are highlighted, but never prevent advancing —
   * "guidance is suggestive, not restrictive". Advancing past one requires a
   * note instead.
   */
  blocking?: boolean;
  /**
   * One plain line saying what the requirement means, shown under it (PM-02).
   * Sean did not know what "add to comparables" asked of him; a checklist
   * item a new user cannot decode is one they cannot satisfy.
   */
  hint?: string;
  /**
   * Manual criteria only: who may satisfy it (Sean, 5 Oct, "Delegated
   * authority and routine approval gates").
   * - 'delegable': a routine decision. Under the project's "Routine decisions:
   *   handle them for me", Go may commit it once validation passes, and the
   *   history says it was committed under that policy.
   * - 'reserved': the user's preferences, judgment or authorization.
   * Absent means reserved: the safe default is the user's.
   */
  authority?: 'delegable' | 'reserved';
}

export interface ArtifactSpec {
  kind: string;
  cardinality: 'one' | 'many';
  primary?: boolean;
}

export interface RecommendedMode {
  mode: ModeType;
  /** <= 80 chars, matching the Smart Setup rationale convention. */
  reason: string;
}

export interface BranchOption {
  id: string;
  label: string;
  renderer: StageRenderer;
  group: StageGroup;
}

export interface StageTransitions {
  /** null means this stage ends the workflow. */
  default_next: string | null;
  allow_skip: boolean;
  /** Stage ids the user may go back to. Forward work is marked stale, never deleted. */
  allow_return_to: string[];
  /** Present only where the user genuinely chooses a path (Book's stage 8). */
  branch_options?: BranchOption[];
  /**
   * The stage a new round starts from (3 Oct call: work that "is going to go
   * on forever"). Offered as "Start the next round", a return the user makes;
   * Go proposes it and the user starts it, so every round is a check-in.
   */
  loop_to?: string;
}

export interface StageDefinition {
  id: string;
  label: string;
  short_label: string;
  group: StageGroup;
  required: boolean;
  renderer: StageRenderer;
  /** Markdown, shown on entry. Two or three sentences. */
  entry_guidance: string;
  /** Injected into this stage's prompts; not shown to the user. */
  entry_prompt_hint?: string;
  exit_criteria: ExitCriterion[];
  expected_artifacts: ArtifactSpec[];
  recommended_modes: RecommendedMode[];
  /** Offered as radio options when skipping; free text is also allowed. */
  skip_reasons: string[];
  transitions: StageTransitions;
}

/**
 * One section of a derived outline.
 *
 * `from_stages` is the whole idea: a paper's structure is a mapping from work
 * already done onto the conventional shape of a write-up. That mapping is a
 * fact about the workflow, not something a model should be asked to invent
 * afresh every time somebody looks at it.
 */
export interface DerivedSectionSpec {
  /**
   * Also the outline item's id, deliberately. Item ids are the lineage binding
   * prose to an outline item, so a derivation re-run after an upstream edit
   * must land on the SAME ids — otherwise every written section detaches
   * itself the moment an earlier stage is touched.
   */
  id: string;
  title: string;
  /** Stage ids this section draws on, in the order their briefs are read. */
  from_stages: string[];
  /** What the section must cover, independent of what upstream produced. */
  guidance: string;
  /**
   * Required sections survive their sources being skipped, carrying an empty
   * brief; optional ones are dropped. A write-up still needs its method
   * section when the method stage is thin, but it does not need a "Related
   * work" heading over nothing at all.
   */
  required: boolean;
}

/**
 * How a `derived` workflow builds its outline (FR-07).
 *
 * Applied by a pure function over this spec and the project's stage artifacts —
 * no model call, for the same reason exit criteria have none. An outline that
 * comes back different every time you look at it is not a plan, and a paper's
 * section structure is a convention rather than a creative act. It also cannot
 * fail because a model timed out.
 */
export interface DerivedOutlineSpec {
  /** The stage that owns the derived outline: the workflow's drafting stage. */
  stage_id: string;
  sections: DerivedSectionSpec[];
  /** What the full form is called where the user chooses between forms. */
  label?: string;
  description?: string;
  /**
   * A shorter form of the same write-up, for work whose reader wants the
   * answer and the reasons, not a paper (1 Oct, item 31: "the Research
   * workflow sometimes becomes much more academic than the business problem
   * requires", repeating one point across Results, Validation, Discussion,
   * Threats, Interpretation and Conclusion). Fewer sections, each drawing on
   * several stages, so a point is made once.
   */
  compact?: {
    label: string;
    description: string;
    sections: DerivedSectionSpec[];
    /** Words in the project's audience or output format that make this the form to start from. */
    default_when?: string[];
  };
}

export interface WorkflowExecution {
  kind: 'finite' | 'ongoing';
  success_criterion: string;
  stop_conditions: string[];
}

export interface WorkflowTemplate {
  key: string;
  version: number;
  name: string;
  description: string;
  /**
   * Book has explicit Outline and Outline-approval stages; Research derives its
   * outline inside Drafting from the artifacts already gathered. Expressing
   * this as a flag rather than a code branch is what keeps one engine.
   */
  outline_stage: 'explicit' | 'derived' | 'none';
  /**
   * Required when `outline_stage` is 'derived', meaningless otherwise. Routing
   * reads `outline_stage`, never the template key: a second derived workflow
   * has to work without a line of new code.
   */
  derived_outline?: DerivedOutlineSpec;
  /**
   * What the finished thing and its parts are called: "book" and "chapter",
   * "research report" and "section". Data, so no screen names a workflow.
   * Optional: versions published before 2026-10-01 fall back
   * (`deliverableNouns` in labels.ts).
   */
  nouns?: { deliverable: string; unit: string };
  /**
   * Work that investigates rather than writes (Research, Exploration, a
   * generated inquiry workflow): Go may reason, derive, test and compute on
   * it. Set on the template rather than inferred from its key, so a workflow a
   * user generates gets the same moves (3 Oct call).
   */
  inquiry?: boolean;
  /**
   * Whether the work ends after one pass or goes on, and what counts as done
   * (7 Oct; Sean, 6 Oct: "Reaching the final stage should not by itself mean
   * the original objective is satisfied"). Go's planner and its objective
   * check read the success criterion; set by the workflow designer.
   */
  execution?: WorkflowExecution;
  stages: StageDefinition[];
}

// --- runtime state ----------------------------------------------------------

/**
 * PM-13. 'complete' is "completed"; 'completed_with_artifact' is completed
 * with the version that is its evidence; 'skipped' is always intentional (a
 * skip cannot be recorded without a reason); 'blocked' carries why. A stage
 * the user moved past with requirements unmet stays 'in_progress' with
 * `left_open` — advancing does not complete a stage.
 */
export type StageStatus =
  | 'not_started'
  | 'in_progress'
  | 'complete'
  | 'completed_with_artifact'
  | 'skipped'
  | 'blocked'
  | 'stale';

export type BlockKind = 'tool_missing' | 'data_missing' | 'needs_decision';

export interface StageState {
  status: StageStatus;
  entered_at?: string;
  completed_at?: string;
  skipped_reason?: string;
  /** Moved past with requirements unmet ("Continue anyway"). Not complete. */
  left_open?: boolean;
  /** The version that is this stage's evidence of completion. */
  evidence_version_id?: string;
  /** The reason given for moving past it with something required open. */
  left_reason?: string;
  /** The head version when the stage was moved past and left open. */
  left_version_id?: string;
  /** `inputs` is what the stage had to work with when it was marked stuck (lib/workflow/stage-inputs.ts). */
  blocked?: { kind: BlockKind; reason: string; inputs?: unknown };
  /** The block that was last cleared, so a stage marked stuck again for the same thing can say so. */
  last_block?: { kind: BlockKind; inputs?: unknown };
  /**
   * Set when a change to the brief reopened this stage for a recheck (5 Oct):
   * why it may no longer hold, which change did it, and what it was before —
   * so "keep them as they are" can put it back.
   */
  stale?: { reason: string; since: string; was: StageStatus };
}

export interface WorkflowState {
  current_stage_id: string;
  stages: Record<string, StageState>;
  /** PM-14: finished by the user, not by ticking every stage. */
  project_status?: 'active' | 'finalized';
}

/** Both kinds of completed. */
export function isDone(status: StageStatus | undefined): boolean {
  return status === 'complete' || status === 'completed_with_artifact';
}

/**
 * Whether a stage's work is handed to later stages. Done stages, and a stage
 * the user moved past with something unticked: the work is still the work they
 * chose to build on, so dropping it would make it vanish from every later
 * prompt while the rail still shows it. Not a completion — exit criteria and
 * progress keep using `isDone`.
 */
export function carriesForward(state: StageState | undefined): boolean {
  return isDone(state?.status) || (state?.status === 'in_progress' && Boolean(state.left_open));
}

/**
 * Must stay in step with the workflow_events type CHECK constraint. A value
 * the database rejects fails at insert time, which is the worst place to find
 * out — see the seed-drift guard for the same problem solved for templates.
 */
export type WorkflowEventType =
  | 'project_created'
  | 'stage_entered'
  | 'stage_completed'
  | 'stage_skipped'
  | 'stage_returned'
  | 'outline_approved'
  | 'outline_version_created'
  | 'section_written'
  | 'section_regenerated'
  | 'job_enqueued'
  | 'job_failed'
  | 'generation_paused'
  | 'generation_resumed'
  | 'imported_from_session'
  | 'stage_marked_complete'
  | 'stage_advanced'
  | 'stage_blocked'
  | 'stage_unblocked'
  | 'project_finalized'
  | 'project_reopened'
  | 'template_upgraded'
  /** C5: a done stage opened for editing without moving the cursor. Closing it again is stage_marked_complete. */
  | 'stage_reopened'
  /** A revision the commit check refused; moves no state (G1, 6 Oct). */
  | 'revision_refused'
  /** The user set "Routine decisions" (6 Oct); payload.routine_decisions. */
  | 'routine_policy_changed'
  /** Go committed a delegable approval under that policy; payload.criterion_id. */
  | 'criterion_committed'
  /**
   * The brief changed (5 Oct). payload: field, kind ('fact' | 'intent' |
   * 'wording'), presentation_only, affected [{stage_id, reason}]. Marks only
   * the affected done stages for recheck.
   */
  | 'brief_changed'
  /** The user kept the stages a brief change reopened; payload.change_at names it. */
  | 'brief_change_dismissed'
  /**
   * Whether the objective is met, judged before Go may say so (7 Oct).
   * payload: outcome, reason, basis_quote, blockers, performed, proposed_next.
   * Moves no state; `objective.ts` reads the latest.
   */
  | 'objective_assessed'
  /**
   * A stage's saved work changed while later stages were done (8 Oct, H1b).
   * payload: version_id, version_number, prior_version_id. Marks every later
   * done stage for recheck, naming the change; written only when there is
   * such work (`laterDoneStages`).
   */
  | 'stage_version_saved';

export interface WorkflowEvent {
  type: WorkflowEventType;
  stage_id: string;
  /** Never 'model' — see the project_stage_events schema note. */
  actor: 'user' | 'system';
  reason?: string;
  to_stage_id?: string;
  /**
   * Event-specific detail. An outline_approved event carries the
   * outline_version_id it approved — without it the log would record that an
   * approval happened but not what was approved, and drafting could not bind
   * to a version.
   */
  payload?: Record<string, unknown>;
  created_at: string;
}

/**
 * Everything the exit-criteria evaluator is allowed to look at. Assembled once
 * per render from data already loaded; nothing here triggers a fetch or a
 * model call.
 */
export interface StageContext {
  fields: Record<string, string>;
  /** Per stage id: how many items that stage's list artifact holds. */
  itemCounts: Record<string, number>;
  /** Per stage id: items still lacking a status value. */
  itemsMissingStatus: Record<string, number>;
  /** Per stage id: rows whose proposed status can be confirmed as it stands (3 Oct). */
  itemsProposed?: Record<string, number>;
  /** Per stage id, per status value: how many rows carry it. */
  itemStatusCounts?: Record<string, Record<string, number>>;
  /** Per stage id, per field key: rows that leave that field empty. */
  itemFieldGaps?: Record<string, Record<string, number>>;
  artifactNonEmpty: Record<string, boolean>;
  outlineApproved: boolean;
  /**
   * Per long-form stage id: sections in the manuscript it works on and how
   * many are written. Keyed by stage, not a single pair, so the same context
   * is right for whichever stage asks — Go evaluates the current stage while
   * the user may be viewing another.
   */
  sections: Record<string, { total: number; complete: number }>;
  /** Per review stage id: findings held and how many carry a status. */
  findings: Record<string, { total: number; triaged: number }>;
  /** Manual criteria the user has ticked, by criterion id. */
  manualChecks: Record<string, boolean>;
  /**
   * Per stage id: the measurable requirements (word ranges, question counts)
   * measured on its saved text (`measurable.ts`, C1). Each is an automatic,
   * blocking check on that stage.
   */
  measured?: Record<string, { id: string; label: string; satisfied: boolean; detail?: string }[]>;
  /**
   * Per review stage id: rows carried forward or deferred whose text says an
   * objective requirement is unmet (`carriedForwardUnmet`, C2). Each is open
   * work for "Objective met", whatever its row status.
   */
  carriedForward?: Record<string, string[]>;
  /** Per review stage id: undecided or proposed rows that say a requirement is unmet (`openUnmet`). */
  openUnmet?: Record<string, number>;
}

export interface CriterionResult {
  id: string;
  label: string;
  satisfied: boolean;
  blocking: boolean;
  /** An approval the template marks routine: Go may commit it under the routine-decision policy. */
  authority?: 'delegable';
  /** Present when unmet: one line on what is missing. */
  detail?: string;
  /**
   * Evaluated as a box the user ticks, whether authored that way or degraded
   * to it (no rule, an unknown rule, or a count rule on a stage that holds no
   * items). The checklist draws a checkbox from this, not from the authored
   * `check` — otherwise a degraded criterion is a circle nobody can fill.
   */
  manual?: boolean;
  /**
   * Authored as an automatic check but evaluated as a box the user ticks,
   * because it cannot be computed here (no rule, an unknown rule, a count on
   * a stage with nothing to count). The checklist says so on the row (C1).
   */
  degraded?: boolean;
  /** The criterion's plain-language hint, carried through for display. */
  hint?: string;
}

export interface StageEvaluation {
  stageId: string;
  criteria: CriterionResult[];
  /** True when nothing blocking is unmet. Advancing anyway is still allowed. */
  canAdvance: boolean;
  unmet: CriterionResult[];
}
