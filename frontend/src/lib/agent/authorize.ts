/**
 * The user's say-so for a run that continues on its own (PM-18, FR-02).
 *
 * Checkpoint and Autonomous runs must cite an accepted `agent_authorization`
 * recommendation for their exact policy — the database refuses the run
 * otherwise (agent_runs_authorized_chk, agent_runs_guard) — and the acceptance
 * is on the decision trail like every other accepted proposal. So the audit
 * chain for anything a run does on its own is:
 *
 *   workflow event → agent run → accepted authorization → decision
 *
 * Written accepted in one insert, because the proposal and the acceptance are
 * the same click: the dialog states the terms and the user presses Authorize.
 */

import { insertRecommendation, recordDecision } from '@/lib/supabase/recommendations';
import type { RecommendationScope } from '@/lib/workflow/recommend';
import type { ExecutionPolicy } from '@/types/agent';

export const POLICY_TERMS: Record<Exclude<ExecutionPolicy, 'guided'>, string[]> = {
  checkpoint: [
    'Go mode chooses and performs moves on its own.',
    'It stops for your approval before important ones: moving stages, revising a draft, running code, changing assumptions.',
    'It can mark a stage stuck, with a reason. It cannot skip, go back or finish the project.',
  ],
  autonomous: [
    'Go mode keeps choosing and performing moves until the work is done, it is genuinely stuck, or it needs a decision only you can make.',
    'It can move between stages, mark a stage complete when the requirements are met, and mark a stage stuck.',
    'It cannot skip a stage, go back, or finish the project — those stay yours.',
  ],
};

export async function authorizeRun(args: {
  projectId: string;
  userId: string;
  policy: Exclude<ExecutionPolicy, 'guided'>;
  budgetSteps: number;
  stageId: string;
  /** Further windows the run may start on its own when one is used up (Autonomous only). */
  autoContinueWindows?: number;
}): Promise<string> {
  const terms = POLICY_TERMS[args.policy];
  const title = args.policy === 'autonomous' ? 'Run Go mode autonomously' : 'Run Go mode with checkpoints';
  // Not a document anchor: this scope is read by the database trigger, never by
  // the apply path, which only ever sees pending, applyable rows.
  const scope = {
    kind: 'agent_authorization',
    policy: args.policy,
    budget_steps: args.budgetSteps,
    auto_continue_windows: args.autoContinueWindows ?? 0,
    described_as: terms.join(' '),
    stage_id: args.stageId,
  } as unknown as RecommendationScope;

  const rec = await insertRecommendation(args.projectId, args.userId, {
    category: `agent_authorization:${args.policy}`,
    kind: 'workflow',
    title,
    summary: terms[0],
    suggested_change: '',
    instruction: '',
    rationale: {
      triggering_issue: 'The user pressed Go with a policy that continues without asking each time.',
      relevant_stage: args.stageId,
      expected_benefit: 'Work continues between decisions instead of waiting on every step.',
      scope: `Windows of ${args.budgetSteps} steps${args.autoContinueWindows ? `, and up to ${args.autoContinueWindows} further window${args.autoContinueWindows === 1 ? '' : 's'} without asking` : ''}.`,
    },
    scope,
    tags: ['go_mode'],
    severity: 'info',
    status: 'accepted',
  });

  await recordDecision(args.projectId, args.userId, {
    decision_type: 'accept_recommendation',
    recommendation_id: rec.id,
    rationale: title,
    metadata: { policy: args.policy, budget_steps: args.budgetSteps, auto_continue_windows: args.autoContinueWindows ?? 0 },
  });
  return rec.id;
}
