/**
 * Does a question Go wants to ask need the user at all? (8 Nov) Pure, apart from
 * the call its caller makes.
 *
 * Whether to ask was the planner's. Under "handle them for me" a second reader,
 * given only the question and the user's own words, says what kind of question
 * it is. A repair is done, a real-world action is recorded, and everything else
 * is asked as before. Anything unclear is asked.
 */

import type { ExecutionPolicy } from '@/types/agent';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';
import { touchesObjective } from './stop-audit';

export type ScreenVerdict = 'routine_repair' | 'real_world_action' | 'business_decision' | 'reserved_approval' | 'missing_input';

export interface QuestionScreen {
  verdict: ScreenVerdict;
  reason: string;
  instruction: string;
  target_stage: string;
  action: string;
  requirement_quote: string;
}

/** Enough recorded on one stage in one window: a third attempt is asked, in case the screen is wrong. */
const MAX_RECORDED = 2;

export function shouldScreen(input: { policy: ExecutionPolicy; routine: string | null | undefined; question: string; recordedHere: number; expert?: boolean }): boolean {
  if (input.policy !== 'autonomous' || input.routine !== 'handle') return false;
  if (input.expert || !input.question.trim() || touchesObjective(input.question)) return false;
  return input.recordedHere < MAX_RECORDED;
}

export type ScreenPlan =
  | { kind: 'ask' }
  | { kind: 'record'; action: string; reason: string }
  | {
      kind: 'repair';
      move: { action_key: string; params: Record<string, unknown>; rationale: string; expected_outcome: string };
    };

export function planFromScreen(
  screen: QuestionScreen,
  input: {
    question: string;
    template: Pick<WorkflowTemplate, 'stages'>;
    stage: Pick<StageDefinition, 'transitions'>;
    allowed: readonly string[];
    returnsLeft: number;
    /** The approval was given on an earlier version, and only Go's routine repairs came since. */
    approvalStands?: boolean;
  }
): ScreenPlan {
  if (screen.verdict === 'real_world_action') return { kind: 'record', action: screen.action, reason: screen.reason };
  if (screen.verdict === 'reserved_approval' && input.approvalStands && input.allowed.includes('declare_objective_complete')) {
    return {
      kind: 'repair',
      move: {
        action_key: 'declare_objective_complete', params: {},
        rationale: 'Not asking for your approval again: it stands for the version you approved, and every version since is one of my routine repairs.',
        expected_outcome: 'The objective judged on the current version, with your approval shown against the version it was given on.',
      },
    };
  }
  if (screen.verdict !== 'routine_repair' || !screen.instruction.trim()) return { kind: 'ask' };
  const instead = `Instead of asking "${input.question.slice(0, 200)}": ${screen.reason || 'this is routine work, and routine decisions are mine to handle.'}`;
  if (screen.target_stage) {
    const target = input.template.stages.find((s) => s.label === screen.target_stage);
    const mayGo = target && (input.stage.transitions.allow_return_to ?? []).includes(target.id) && input.returnsLeft > 0;
    if (!mayGo) return { kind: 'ask' };
    return {
      kind: 'repair',
      move: {
        action_key: 'return_to_stage',
        params: { stage_id: target.id, work: screen.instruction, reason: screen.reason || screen.instruction },
        rationale: instead,
        expected_outcome: `${screen.instruction} Done on ${target.label}, and what depends on it rechecked.`,
      },
    };
  }
  if (!input.allowed.includes('revise_stage')) return { kind: 'ask' };
  return {
    kind: 'repair',
    move: { action_key: 'revise_stage', params: { instruction: screen.instruction }, rationale: instead, expected_outcome: screen.instruction },
  };
}
