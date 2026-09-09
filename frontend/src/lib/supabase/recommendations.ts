/**
 * The `recommendations` and `decisions` tables — the proposal boundary, FR-02.
 *
 * The flow M1's schema comment describes and this module finally performs:
 * model output -> validated -> inserted here as a proposal -> the user acts ->
 * a `decisions` row -> only then does application state change.
 *
 * ## What is written, and when
 *
 * **Evaluation-driven recommendations are written the moment they exist.**
 * They cost a model call, and FR-01 lists recommendations among the things
 * that must survive refresh, logout and a different browser session.
 *
 * **Derived recommendations are not.** They are recomputed from the template
 * and the stage evaluation on every render (see
 * `deriveWorkflowRecommendations`), and writing them on sight would be a slow
 * leak: `recommendations` has no delete policy — deliberately, because "the
 * record that a proposal was made" is audit evidence — so every render of
 * every stage would accrete a row nobody can ever remove. A row appears only
 * when the user acts on one, and a dismissal is remembered by `category` key
 * so it survives a reload without a row having existed beforehand.
 *
 * ## Why there is no `deleteRecommendation`
 *
 * RLS grants select, insert and update, and no delete. Dismissing sets a
 * status; it does not erase the proposal. A trigger added in
 * `20260909000000_recommendation_governance.sql` then freezes a resolved
 * recommendation's substance and only lets its status move forward, so
 * "the user rejected this" is not reversible after the fact.
 */

import { createClient } from './client';
import type {
  ProposedRecommendation,
  RecommendationKind,
  RecommendationRationale,
  RecommendationScope,
  RecommendationSeverity,
  RecommendationStatus,
} from '@/lib/workflow/recommend';

export interface Recommendation {
  id: string;
  user_id: string;
  project_id: string;
  version_id: string | null;
  kind: RecommendationKind;
  source: string;
  /** The derived-recommendation identity key. Null for anything model-authored. */
  category: string | null;
  title: string;
  summary: string;
  suggested_change: string;
  rationale: RecommendationRationale;
  /** Non-empty ⇔ applyable. */
  instruction: string;
  scope: RecommendationScope;
  tags: string[];
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  resolved_at: string | null;
  resulting_version_id: string | null;
  source_model: string;
  created_at: string;
}

const COLUMNS =
  'id, user_id, project_id, version_id, kind, source, category, title, summary, ' +
  'suggested_change, rationale, instruction, scope, tags, severity, status, ' +
  'resolved_at, resulting_version_id, source_model, created_at';

export async function listRecommendations(projectId: string): Promise<Recommendation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('recommendations')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Recommendation[];
}

export interface NewRecommendation extends ProposedRecommendation {
  /** The artifact version this judges, when there is one. */
  version_id?: string | null;
  /** 'system' for derived, the model id for evaluation-driven. */
  source_model?: string;
  status?: RecommendationStatus;
}

/**
 * Write a proposal.
 *
 * `status` defaults to `pending`, which is the whole point of the table: a
 * recommendation exists in a state where the model has proposed and the user
 * has not agreed. It is passed explicitly only when the user's very first
 * interaction with a derived recommendation is to dismiss it — there was no
 * row before that click, so there is nothing to update.
 */
export async function insertRecommendation(
  projectId: string,
  userId: string,
  rec: NewRecommendation
): Promise<Recommendation> {
  const supabase = createClient();
  const status = rec.status ?? 'pending';
  const { data, error } = await supabase
    .from('recommendations')
    .insert({
      project_id: projectId,
      user_id: userId,
      version_id: rec.version_id ?? null,
      kind: rec.kind,
      source: rec.source_model ? 'model' : 'system',
      category: rec.category,
      title: rec.title,
      summary: rec.summary,
      suggested_change: rec.suggested_change,
      rationale: rec.rationale,
      instruction: rec.instruction,
      scope: rec.scope,
      tags: rec.tags,
      severity: rec.severity,
      status,
      // The trigger owns this on UPDATE; an insert that is already resolved
      // never passes through an update, so it is set here.
      resolved_at: status === 'pending' ? null : new Date().toISOString(),
      source_model: rec.source_model ?? '',
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as Recommendation;
}

export type DecisionType =
  | 'accept_recommendation'
  | 'dismiss_recommendation'
  | 'restore_version'
  | 'skip_stage'
  | 'advance_stage'
  | 'return_stage'
  | 'finalize'
  | 'rate_version';

/**
 * Append to the decision trail.
 *
 * `decisions` is append-only: RLS grants select and insert, no update and no
 * delete. It is the table you would hand someone to prove FR-02, so nothing
 * here offers a way to revise it.
 *
 * **There is no `defer_recommendation` value.** Deferring therefore does not
 * appear in this trail at all — it leaves the recommendation `pending` and
 * writes a `project_tasks` row instead. That is a real gap, documented in
 * `lib/workflow/recommend.ts`, and it is left open rather than closed by
 * widening a CHECK constraint that is contract evidence.
 */
export async function recordDecision(
  projectId: string,
  userId: string,
  decision: {
    decision_type: DecisionType;
    recommendation_id?: string | null;
    version_id?: string | null;
    rationale?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('decisions').insert({
    project_id: projectId,
    user_id: userId,
    decision_type: decision.decision_type,
    recommendation_id: decision.recommendation_id ?? null,
    version_id: decision.version_id ?? null,
    rationale: decision.rationale ?? null,
    metadata: decision.metadata ?? {},
  });
  if (error) throw error;
}

/**
 * Mark a recommendation resolved.
 *
 * `resolved_at` is deliberately not sent: the trigger sets it, for the same
 * reason `revision` is trigger-owned — a client that could date its own
 * decision could date it to whenever suited.
 */
export async function resolveRecommendation(
  id: string,
  status: Exclude<RecommendationStatus, 'pending'>,
  resultingVersionId?: string | null
): Promise<Recommendation> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('recommendations')
    .update({
      status,
      ...(resultingVersionId ? { resulting_version_id: resultingVersionId } : {}),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as Recommendation;
}

/**
 * The category keys the user has already dismissed on this project.
 *
 * Derived recommendations have no stable row id — they may have no row at all
 * — so "I dismissed this one" is remembered by the key
 * `deriveWorkflowRecommendations` computes from the stage and the criterion.
 * Filtering on reload is what makes a dismissal survive a refresh (FR-01).
 */
export function dismissedCategories(rows: readonly Recommendation[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.status === 'dismissed' && row.category) keys.add(row.category);
  }
  return keys;
}

/** Rows still awaiting a decision, worst first is applied by the caller. */
export function pending(rows: readonly Recommendation[]): Recommendation[] {
  return rows.filter((r) => r.status === 'pending');
}
