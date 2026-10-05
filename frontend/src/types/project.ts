/**
 * Phase 2 relational domain: projects, artifacts, versions, evaluations.
 *
 * Kept separate from types/index.ts, which mirrors the backend's Pydantic
 * schemas by hand. These types mirror database tables instead, and the two
 * shapes diverge deliberately — a version row carries provenance the backend's
 * Iteration does not (parent pointers, restore lineage, per-row ownership).
 */

import type {
  ModeType,
  LongFormState,
  ContinuitySnapshot,
  WhyThisWorks,
  AuditFinding,
  CritiqueIntensity,
  CritiqueTone,
} from './index';
import type { OutlineDocument } from './outline';

export type ProjectStatus = 'active' | 'finalized' | 'archived';
export type ScoreValue = 'Low' | 'Medium' | 'High';

/** A data file attached to a project (`project_files`); read by code the project runs. */
export interface ProjectFile {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  path: string;
  content_type: string;
  bytes: number;
  preview: import('@/lib/data/preview').DataPreview;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  /**
   * The project's data files. Not a column: joined on in the browser when
   * the project is opened, so everything that is handed the project — stage
   * generation, the Go planner, the code writer — knows what data exists.
   */
  data_files?: ProjectFile[];

  title: string;
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;
  /**
   * Source material the user pasted: facts, figures, background. The
   * objective stays short and authoritative; this can be long (4 Oct: a
   * board-level brief overloaded the objective past its limit).
   */
  context?: string;

  mode: ModeType;
  custom_name: string;
  custom_preamble: string;
  custom_tone: string;

  model: string;
  session_facts: string[];
  active_stack_id: string | null;
  constraint_presets: string[];
  format_presets: string[];

  workflow: string;
  /** Pins the exact template version this project started on. */
  workflow_template_id: string | null;
  stage: string;
  status: ProjectStatus;
  /** User-ticked exit criteria, keyed by criterion id. */
  manual_checks: Record<string, boolean>;
  /** PM-21: the project's critique dials. */
  critique_intensity?: CritiqueIntensity;
  critique_tone?: CritiqueTone;

  /** Bumped by a database trigger on every update; the FR-21 concurrency guard. */
  revision: number;

  archived_at: string | null;
  deleted_at: string | null;
  legacy_session_id: string | null;

  created_at: string;
  updated_at: string;
}

/** The shape the project list needs — deliberately not the whole row. */
export interface ProjectSummary {
  id: string;
  title: string;
  objective: string;
  mode: ModeType;
  workflow: string;
  stage: string;
  status: ProjectStatus;
  updated_at: string;
  created_at: string;
}

/**
 * A soft-deleted project, as the trash view needs it.
 *
 * `deleted_at` is not optional here: the whole point of the view is showing how
 * much of the retention window is left, and a summary that could omit it would
 * let a caller render "Deleted" with no clock beside it.
 */
export interface DeletedProjectSummary extends ProjectSummary {
  deleted_at: string;
}

export interface Artifact {
  id: string;
  user_id: string;
  project_id: string;
  kind: 'output' | 'outline' | 'long_form_document' | 'export';
  name: string;
  /**
   * Which stage owns this artifact. Free text with no FK, because stage ids
   * live inside a workflow template's JSONB. Nullable because the column
   * predates stages; in practice nothing writes null any more — the M1 import
   * filed all 65 legacy artifacts onto single output's `output` stage.
   */
  stage_id: string | null;
  /**
   * A few lines projecting what this stage concluded, written when the stage
   * completes. Feeds the digest that later stages generate against, so prompt
   * size grows with the number of stages rather than the length of the book.
   */
  summary: string | null;
  /** The figures this stage established, and the version they were read from (see lib/workflow/figures.ts). */
  key_figures?: { version_id?: string; figures?: { name: string; value: string; context: string; source?: 'sandbox' }[] } | null;
  current_version_id: string | null;
  version_count: number;
  long_form: LongFormState | null;
  /**
   * The outline's uncommitted working copy (FR-07). Mutable by design: a
   * version row can never be edited in place, so the draft cannot be one.
   */
  outline_draft: OutlineDocument | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: string;
  user_id: string;
  project_id: string;
  artifact_id: string;

  version_number: number;
  parent_version_id: string | null;

  /** FR-10 provenance. */
  source_operation: string;
  instruction: string;
  system_prompt: string;
  content: string;
  model: string;
  mode: ModeType;
  change_summary: string | null;

  /** Set when this version was produced by restoring an earlier one. */
  restored_from_version_id: string | null;

  finish_reason: string | null;
  user_rating: 'positive' | 'negative' | null;
  continuity_snapshot: ContinuitySnapshot | null;

  created_at: string;
}

export interface Evaluation {
  id: string;
  user_id: string;
  project_id: string;
  version_id: string;

  alignment_score: ScoreValue;
  alignment_explanation: string;
  drift_score: ScoreValue;
  drift_explanation: string;
  clarity_score: ScoreValue;
  clarity_explanation: string;

  completeness_status: string | null;
  completeness_reason: string | null;
  interpretation: WhyThisWorks | null;
  /**
   * FR-11's findings, in the column M1 pre-carved for them.
   *
   * Typed as AuditFinding rather than `unknown[]`: the column has existed
   * since M1, defaulted to `'[]'`, been written empty by `saveEvaluation` and
   * read by nothing. `/api/evaluate-stage-artifact` is what finally fills it,
   * and a row written by an older build is simply an empty array.
   */
  findings: AuditFinding[];

  /** PM-25: null when the evaluator was not asked (older evaluations). */
  further_pass_needed?: boolean | null;
  further_pass_reason?: string | null;

  /** Generated column: alignment === 'Low' || drift === 'High'. */
  needs_realignment: boolean;

  evaluator_model: string;
  source: 'pipeline' | 'restored' | 'manual';
  created_at: string;
}

/** Fields a client may set when creating a project. */
export interface ProjectInput {
  title?: string;
  objective?: string;
  audience?: string;
  constraints?: string;
  output_format?: string;
  context?: string;
  mode?: ModeType;
  model?: string;
  workflow?: string;
}

/**
 * Fields a client may patch. Deliberately excludes revision, user_id and the
 * timestamps: revision is owned by a trigger, and letting a caller set it
 * would defeat the concurrency guard it exists to provide.
 */
export type ProjectPatch = Partial<
  Pick<
    Project,
    | 'title'
    | 'objective'
    | 'audience'
    | 'constraints'
    | 'context'
    | 'output_format'
    | 'mode'
    | 'custom_name'
    | 'custom_preamble'
    | 'custom_tone'
    | 'model'
    | 'session_facts'
    | 'active_stack_id'
    | 'constraint_presets'
    | 'format_presets'
    | 'workflow'
    | 'workflow_template_id'
    | 'stage'
    | 'status'
    | 'manual_checks'
    | 'critique_intensity'
    | 'critique_tone'
  >
>;

/**
 * Why a revision-guarded update returned no rows. Under RLS a zero-row result
 * is ambiguous — stale revision, row not visible, or row deleted — so the
 * caller re-reads to tell them apart. Getting this wrong shows "someone else
 * edited this" for a project that was actually deleted, and users click
 * Overwrite.
 */
export type ConflictReason = 'stale' | 'deleted';

export class ProjectConflictError extends Error {
  constructor(
    readonly reason: ConflictReason,
    /** The current server state, when the row still exists. */
    readonly current: Project | null
  ) {
    super(
      reason === 'deleted'
        ? 'This project was deleted elsewhere.'
        : 'This project was changed in another tab.'
    );
    this.name = 'ProjectConflictError';
  }
}

