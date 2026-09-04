/**
 * Phase 2 relational domain: projects, artifacts, versions, evaluations.
 *
 * Kept separate from types/index.ts, which mirrors the backend's Pydantic
 * schemas by hand. These types mirror database tables instead, and the two
 * shapes diverge deliberately — a version row carries provenance the backend's
 * Iteration does not (parent pointers, restore lineage, per-row ownership).
 */

import type { ModeType, LongFormState, ContinuitySnapshot, WhyThisWorks } from './index';

export type ProjectStatus = 'active' | 'finalized' | 'archived';
export type ScoreValue = 'Low' | 'Medium' | 'High';

export interface Project {
  id: string;
  user_id: string;

  title: string;
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;

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

export interface Artifact {
  id: string;
  user_id: string;
  project_id: string;
  kind: 'output' | 'long_form_document' | 'export';
  name: string;
  /**
   * Which stage owns this artifact. Null for the 65 imported projects, which
   * predate stages entirely; free text with no FK because stage ids live
   * inside a workflow template's JSONB.
   */
  stage_id: string | null;
  /**
   * A few lines projecting what this stage concluded, written when the stage
   * completes. Feeds the digest that later stages generate against, so prompt
   * size grows with the number of stages rather than the length of the book.
   */
  summary: string | null;
  current_version_id: string | null;
  version_count: number;
  long_form: LongFormState | null;
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
  findings: unknown[];

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
    | 'stage'
    | 'status'
    | 'manual_checks'
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
