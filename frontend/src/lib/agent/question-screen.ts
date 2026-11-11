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
import { DELEGATED_RULE } from '@/lib/workflow/answers';

export type ScreenVerdict = 'routine_repair' | 'routine_choice' | 'real_world_action' | 'business_decision' | 'reserved_approval' | 'missing_input';

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
  // A word like "scope" or "requirements" in the question no longer keeps it
  // from the screen (8 Nov): the screen reads the user's own words and says
  // itself when a question is a business decision.
  if (input.expert || !input.question.trim()) return false;
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
  // A choice with no wrong answer is Go's under "handle them for me": what
  // pressing "Do whatever is best" did, without the press (8 Nov, a client). The
  // revision decides it in the text and the choice is recorded as a fact the
  // user can change.
  if (screen.verdict === 'routine_choice') {
    if (!input.allowed.includes('revise_stage')) return { kind: 'ask' };
    const asked = input.question.trim().slice(0, 1000);
    return {
      kind: 'repair',
      move: {
        action_key: 'revise_stage',
        params: { instruction: `Settle this question yourself rather than asking it: "${asked}".${DELEGATED_RULE}`, left_to_go: asked },
        rationale: `Instead of asking "${input.question.slice(0, 200)}": ${screen.reason || 'either answer fits what you asked for, and routine decisions are mine to handle.'}`,
        expected_outcome: 'The question decided in the text, and the choice recorded as a fact you can change.',
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
  if (!input.allowed.includes('revise_stage')) {
    // Routine, and this run has used up its edits on the stage: judged as it stands
    // and said, not asked (9 Nov, production: "trim it, or accept it?" over 7% on a
    // hedged target, because "further edits are paused for this run").
    if (!input.allowed.includes('declare_objective_complete')) return { kind: 'ask' };
    return {
      kind: 'repair',
      move: {
        action_key: 'declare_objective_complete',
        params: { set_aside_question: input.question.slice(0, 1000) },
        rationale: `${instead} This run has used up its edits on this stage, so the work is judged as it stands.`,
        expected_outcome: 'The objective judged on the current version, with this noted for you.',
      },
    };
  }
  return {
    kind: 'repair',
    move: { action_key: 'revise_stage', params: { instruction: screen.instruction }, rationale: instead, expected_outcome: screen.instruction },
  };
}

/** At most this many undecided major findings are read per stage in a run. */
export const MAX_FINDINGS_SCREENED = 6;

/** A finding put as the question it would be if it were asked: whether to make the change. */
export function findingAsQuestion(row: object): string {
  const field = (key: string) => {
    const value = (row as Record<string, unknown>)[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const finding = field('finding');
  const change = field('suggested_change');
  return `A check on this project found: "${finding}"${change ? ` Suggested change: "${change}"` : ''} Should this change be made?`;
}

