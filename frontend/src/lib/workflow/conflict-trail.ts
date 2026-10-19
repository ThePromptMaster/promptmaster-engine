/**
 * Where PM-24's inputs come from, and where its answers go.
 *
 * Prior decisions are the project's own decision trail: recommendations the
 * user accepted or dismissed, and earlier "which should control?" answers.
 * Each answer is recorded the same way as any other accepted or dismissed
 * proposal — a `recommendations` row plus a `decisions` row — so no CHECK
 * constraint is widened, and the next conflict check reads it back as a
 * decision the user already made.
 */

import {
  insertRecommendation,
  listRecommendations,
  recordDecision,
  resolveRecommendation,
  type Recommendation,
} from '@/lib/supabase/recommendations';
import type { RecommendationScope } from './recommend';
import { api } from '@/lib/api/client';
import type { Project } from '@/types/project';
import { choiceLabels, gist, mergeConflicts, nameOf, ruleConflicts, type ConflictSource, type Controls, type InstructionConflict } from './instruction-conflicts';
import { inputsFrom } from './stage-requests';

export const CONFLICT_CATEGORY = 'conflict:';

/**
 * A change waiting on a "which takes priority?" answer.
 *
 * The question used to live only in the side chat's memory: leaving the card
 * — another stage, a reload, closing the chat — lost the change without a
 * trace (16 Oct, Sean, NORTHSTAR-2: the March 6 withdrawal was checked at
 * 23:34 and never saved, and nothing said so). It is held as a pending row
 * the moment the question is asked, and settled when it is answered or
 * withdrawn. The row deliberately has no `scope.stage_id` and no version, so
 * it is never a stage proposal, never superseded by leaving a stage, and
 * never read as a pending instruction by the next conflict check.
 */
export const PENDING_CHANGE_CATEGORY = 'pending-change:';

export interface PendingChange {
  id: string;
  stageId: string;
  instruction: string;
  conflicts: InstructionConflict[];
  createdAt: string;
}

export const isPendingChangeRow = (r: Pick<Recommendation, 'category'>): boolean =>
  Boolean(r.category?.startsWith(PENDING_CHANGE_CATEGORY));

/** Changes the user has not yet chosen for, oldest first. */
export function pendingChanges(rows: readonly Recommendation[]): PendingChange[] {
  return rows
    .filter((r) => r.status === 'pending' && isPendingChangeRow(r))
    .map((r) => {
      const held = r.rationale as unknown as { conflicts?: InstructionConflict[] };
      const scope = r.scope as unknown as { pending_stage_id?: string };
      return {
        id: r.id,
        stageId: scope.pending_stage_id ?? '',
        instruction: r.suggested_change,
        conflicts: Array.isArray(held.conflicts) ? held.conflicts : [],
        createdAt: r.created_at,
      };
    })
    .filter((c) => c.stageId && c.instruction.trim());
}

/** Hold a change that is waiting on a priority answer. */
export async function holdPendingChange(args: {
  projectId: string;
  userId: string;
  stageId: string;
  stageLabel: string;
  instruction: string;
  conflicts: InstructionConflict[];
}): Promise<Recommendation> {
  return insertRecommendation(args.projectId, args.userId, {
    category: `${PENDING_CHANGE_CATEGORY}${Date.now()}`,
    kind: 'workflow',
    title: `Not applied yet: ${gist(args.instruction)}`,
    summary: `Waiting for your choice on ${args.stageLabel}.`,
    suggested_change: args.instruction,
    instruction: '',
    rationale: {
      triggering_issue: args.conflicts[0]?.explanation ?? '',
      relevant_stage: args.stageId,
      expected_benefit: 'The change is kept until you choose, instead of being lost.',
      scope: 'A change waiting for a priority answer',
      conflicts: args.conflicts,
    } as never,
    scope: { kind: 'document', described_as: 'A change waiting for your choice', pending_stage_id: args.stageId } as never,
    tags: ['conflict'],
    severity: 'minor',
  });
}

/** Answered (`applied`) or taken back (`withdrawn`). */
export function settlePendingChange(id: string, outcome: 'applied' | 'withdrawn'): Promise<Recommendation> {
  return resolveRecommendation(id, outcome === 'applied' ? 'accepted' : 'dismissed');
}

export async function conflictContext(
  projectId: string,
  stageId: string,
  recentInstructions: string[],
  /**
   * The version the instruction would change. Only pending fixes raised on it
   * are live instructions; ones raised on an earlier version were about text
   * that no longer exists, and a "Move on" proposal is not an instruction.
   */
  headVersionId: string | null = null
): Promise<{ decisions: ConflictSource[]; others: ConflictSource[] }> {
  const rows = await listRecommendations(projectId).catch(() => []);
  const decisions: ConflictSource[] = rows
    .filter(
      (r) =>
        (r.status === 'accepted' || r.status === 'dismissed') &&
        (r.scope as { kind?: string })?.kind !== 'agent_authorization' &&
        !isPendingChangeRow(r)
    )
    .slice(-15)
    .map((r) => ({
      id: r.id,
      text: r.category?.startsWith(CONFLICT_CATEGORY)
        ? r.title
        : `${r.status === 'accepted' ? 'Accepted' : 'Dismissed'}: ${r.title}${r.instruction ? ` — ${r.instruction}` : ''}`,
    }));
  const others: ConflictSource[] = [
    ...rows
      .filter(
        (r) =>
          r.status === 'pending' &&
          r.instruction &&
          r.kind !== 'stage_transition' &&
          (r.scope as RecommendationScope)?.stage_id === stageId &&
          (headVersionId === null || (r.version_id ?? null) === headVersionId)
      )
      .map((r) => ({ id: r.id, text: r.instruction })),
    ...recentInstructions.slice(-5).map((text, i) => ({ id: `chat-${i}`, text })),
  ];
  // An instruction already recorded as a decision is not also pending: the
  // November 12 update was listed both ways and asked about twice (14 Oct).
  const decided = decisions.map((d) => d.text.toLowerCase());
  return { decisions, others: others.filter((o) => !decided.some((d) => d.includes(gist(o.text, 80).replace(/…$/, '').toLowerCase()))) };
}

/**
 * Does this instruction contradict the objective, the constraints, a decision
 * already made, or another pending instruction?
 *
 * One function for every place an instruction comes from. It lived inside
 * the side chat's Send, so only a typed "Change it" was ever checked: an
 * action button, or a revision Go chose for itself, went straight to the
 * model (1 Oct, item 33: "the latest instruction should not silently
 * overwrite the project"). Never throws: a check that cannot run is no
 * conflicts, not a blocked instruction.
 */
export async function findInstructionConflicts(args: {
  project: Project;
  stageId: string;
  instruction: string;
  recentInstructions?: string[];
  headVersionId?: string | null;
  /** The stage the instruction is for: its own work is not a conflict with the constraints. */
  stage?: { label: string; instruction?: string };
}): Promise<InstructionConflict[]> {
  const { project, stageId, instruction, recentInstructions = [], headVersionId = null, stage } = args;
  if (!instruction.trim()) return [];
  try {
    const { decisions, others } = await conflictContext(project.id, stageId, recentInstructions, headVersionId);
    const rule = ruleConflicts({ instruction, objective: project.objective, constraints: project.constraints, decisions, others });
    let model: InstructionConflict[] = [];
    try {
      const res = await api.checkConflicts({
        inputs: inputsFrom(project), instruction, decisions, other_instructions: others, model: project.model,
        ...(stage ? { stage: { label: stage.label, instruction: (stage.instruction ?? '').slice(0, 2_000) } } : {}),
      });
      model = res.conflicts.map((c) => ({ ...c, source: 'model' as const }));
    } catch {
      // The model half failing never blocks an instruction; the rule's half still counts.
    }
    return mergeConflicts(rule, model);
  } catch {
    return [];
  }
}

export async function recordConflictChoice(args: {
  projectId: string;
  userId: string;
  stageId: string;
  instruction: string;
  conflict: InstructionConflict;
  controls: Controls;
  /**
   * L-93: kept under the routine-decision policy, not chosen by the user.
   * Recorded the same way, saying so, with `policy: 'routine_decisions'`.
   */
  routine?: boolean;
}): Promise<void> {
  const { conflict, controls, instruction, routine = false } = args;
  // Plain words, never a quote inside a quote: this title is read back as an
  // earlier decision by the next check (14 Oct, Sean, LANTERN).
  const { keep, override } = choiceLabels(conflict);
  const title = routine
    ? `Kept "${keep}" under the routine-decision policy, over the request: ${gist(instruction)}`
    : controls === 'new'
      ? `Chose "${override}" over ${nameOf(conflict)}, for the instruction: ${gist(instruction)}`
      : `Chose "${keep}" over the instruction: ${gist(instruction)}`;
  const rec = await insertRecommendation(args.projectId, args.userId, {
    category: `${CONFLICT_CATEGORY}${Date.now()}`,
    kind: 'workflow',
    title,
    summary: conflict.explanation,
    suggested_change: '',
    instruction: '',
    rationale: {
      triggering_issue: conflict.explanation,
      relevant_stage: args.stageId,
      expected_benefit: 'PromptMaster is told which one takes priority instead of guessing.',
      scope: `Conflicts with ${conflict.kind}: ${conflict.with_text.slice(0, 300)}`,
    },
    scope: { kind: 'document', described_as: 'A conflict between instructions', stage_id: args.stageId },
    tags: ['conflict'],
    severity: 'minor',
    // The row is the user's answer, whichever side it took: keeping the
    // record is a choice made, not a suggestion turned down. It was stored as
    // `dismissed` for "keep", which read as rejected (15 Oct, HARBOR).
    status: 'accepted',
  });
  await recordDecision(args.projectId, args.userId, {
    decision_type: 'accept_recommendation',
    recommendation_id: rec.id,
    rationale: title,
    metadata: { conflict_kind: conflict.kind, with_id: conflict.with_id, source: conflict.source, controls, ...(routine ? { policy: 'routine_decisions' } : {}) },
  });
}
