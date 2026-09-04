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
  stages: StageDefinition[];
}

// --- runtime state ----------------------------------------------------------

export type StageStatus = 'not_started' | 'in_progress' | 'complete' | 'skipped' | 'stale';

export interface StageState {
  status: StageStatus;
  entered_at?: string;
  completed_at?: string;
  skipped_reason?: string;
}

export interface WorkflowState {
  current_stage_id: string;
  stages: Record<string, StageState>;
}

export type WorkflowEventType =
  | 'stage_entered'
  | 'stage_completed'
  | 'stage_skipped'
  | 'stage_returned'
  | 'outline_approved'
  | 'section_written'
  | 'job_enqueued'
  | 'job_failed';

export interface WorkflowEvent {
  type: WorkflowEventType;
  stage_id: string;
  /** Never 'model' — see the project_stage_events schema note. */
  actor: 'user' | 'system';
  reason?: string;
  to_stage_id?: string;
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
  artifactNonEmpty: Record<string, boolean>;
  outlineApproved: boolean;
  sectionsTotal: number;
  sectionsComplete: number;
  findingsTotal: number;
  findingsTriaged: number;
  /** Manual criteria the user has ticked, by criterion id. */
  manualChecks: Record<string, boolean>;
}

export interface CriterionResult {
  id: string;
  label: string;
  satisfied: boolean;
  blocking: boolean;
  /** Present when unmet: one line on what is missing. */
  detail?: string;
}

export interface StageEvaluation {
  stageId: string;
  criteria: CriterionResult[];
  /** True when nothing blocking is unmet. Advancing anyway is still allowed. */
  canAdvance: boolean;
  unmet: CriterionResult[];
}
