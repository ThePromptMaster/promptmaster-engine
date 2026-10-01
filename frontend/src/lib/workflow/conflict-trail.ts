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

import { insertRecommendation, listRecommendations, recordDecision } from '@/lib/supabase/recommendations';
import type { RecommendationScope } from './recommend';
import { api } from '@/lib/api/client';
import type { Project } from '@/types/project';
import { describeWith, mergeConflicts, ruleConflicts, type ConflictSource, type Controls, type InstructionConflict } from './instruction-conflicts';
import { inputsFrom } from './stage-requests';

export const CONFLICT_CATEGORY = 'conflict:';

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
    .filter((r) => (r.status === 'accepted' || r.status === 'dismissed') && (r.scope as { kind?: string })?.kind !== 'agent_authorization')
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
  return { decisions, others };
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
}): Promise<InstructionConflict[]> {
  const { project, stageId, instruction, recentInstructions = [], headVersionId = null } = args;
  if (!instruction.trim()) return [];
  try {
    const { decisions, others } = await conflictContext(project.id, stageId, recentInstructions, headVersionId);
    const rule = ruleConflicts({ instruction, objective: project.objective, constraints: project.constraints, decisions, others });
    let model: InstructionConflict[] = [];
    try {
      const res = await api.checkConflicts({
        inputs: inputsFrom(project), instruction, decisions, other_instructions: others, model: project.model,
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
}): Promise<void> {
  const { conflict, controls, instruction } = args;
  const title =
    controls === 'new'
      ? `"${instruction.slice(0, 160)}" takes precedence over ${describeWith(conflict)}`
      : `${describeWith(conflict)} takes precedence over "${instruction.slice(0, 160)}"`;
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
    status: controls === 'new' ? 'accepted' : 'dismissed',
  });
  await recordDecision(args.projectId, args.userId, {
    decision_type: controls === 'new' ? 'accept_recommendation' : 'dismiss_recommendation',
    recommendation_id: rec.id,
    rationale: title,
    metadata: { conflict_kind: conflict.kind, with_id: conflict.with_id, source: conflict.source },
  });
}
