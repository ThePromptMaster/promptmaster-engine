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

export type ScreenVerdict = 'routine_repair' | 'routine_choice' | 'real_world_action' | 'business_decision' | 'reserved_approval' | 'missing_input' | 'optional_suggestion' | 'changes_supplied';

export interface QuestionScreen {
  verdict: ScreenVerdict;
  reason: string;
  instruction: string;
  target_stage: string;
  action: string;
  requirement_quote: string;
  /** `optional_suggestion`: Go's own extra, left out and mentioned (15 Nov). */
  suggestion?: string;
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
  /** An extra Go thought of itself that nothing the user said needs: noted, left out, never asked (15 Nov). */
  | { kind: 'leave_out'; suggestion: string; reason: string }
  | {
      kind: 'repair';
      move: { action_key: string; params: Record<string, unknown>; rationale: string; expected_outcome: string };
    };

/**
 * A request to take out a note to the user that ended up in the work (20 Nov, Sean,
 * warehouse rerun: "Should I make one more pass to remove the opening note about
 * the announcement conflict…?"). Both halves must be there: taking something out,
 * and it being a note to the user rather than part of the work.
 */
const REMOVE = /\b(?:remove|removing|delete|take\s+out|taking\s+out|strip|drop|cut)\b/i;
const NOTE_TO_USER =
  /\b(?:note|comment|message|remark|aside)s?\b[^.?\n]{0,60}?\b(?:to|for)\s+(?:you|the\s+user)\b|\b(?:internal|editing|editorial|working|process|drafting)\s+(?:note|comment|text|remark)s?\b|\bopening\s+(?:note|paragraph\s+about\s+how)\b|\bnote\s+(?:to\s+you\s+)?at\s+the\s+(?:top|start|end)\b/i;

export function asksToRemoveNote(question: string): boolean {
  return REMOVE.test(question) && NOTE_TO_USER.test(question);
}

/** A request that fixes an error of fact in the text, not one that polishes it. */
const CORRECTION = /\b(?:citation|cite[sd]?|reference|attribut(?:ion|ed|e)|author(?:ship|s)?|misattribut\w*|wrong (?:year|date|name|figure|number|title)|incorrect(?:ly)?|correct (?:the|its|a)\b|typo|misspell\w*)\b/i;

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
    /** Corrections this run already made on this stage beyond its edit limit (17 Nov). */
    correctionsBeyondLimit?: number;
    /** Passes this run already made on this stage beyond its edit limit to take out a note to the user (20 Nov). */
    removalsBeyondLimit?: number;
    /** The edit limit is what took revising away (19 Nov): said only then. */
    editsCapped?: boolean;
    /** The workflow's last stage: there is nothing to move on to (19 Nov). */
    lastStage?: boolean;
  }
): ScreenPlan {
  if (screen.verdict === 'real_world_action') return { kind: 'record', action: screen.action, reason: screen.reason };
  if (screen.verdict === 'optional_suggestion') return { kind: 'leave_out', suggestion: screen.suggestion || input.question, reason: screen.reason };
  // 19 Nov (Sean, packaging vendors): no vendor met his eight-week deadline, and Go
  // asked whether to allow nine or ten weeks. "I expected it to keep the existing
  // requirement and finish the package with 'no vendor currently confirmed to qualify.'"
  if (screen.verdict === 'changes_supplied') {
    const kept = screen.requirement_quote.trim();
    if (!kept) return { kind: 'ask' };
    const rationale = `Not asking whether to change your requirement "${kept.slice(0, 200)}": it stands as you supplied it. Where no option meets it, the work says so, with what each misses by and what would have to be confirmed.`;
    if (input.allowed.includes('declare_objective_complete')) {
      return {
        kind: 'repair',
        move: {
          action_key: 'declare_objective_complete', params: { kept_requirement: kept.slice(0, 500) }, rationale,
          expected_outcome: 'The objective judged with your requirement as it stands.',
        },
      };
    }
    if (input.allowed.includes('revise_stage')) {
      return {
        kind: 'repair',
        move: {
          action_key: 'revise_stage',
          params: {
            instruction: `Keep the user's requirement exactly as supplied ("${kept.slice(0, 400)}"). Where no option meets it, say that none is currently confirmed to qualify, what each option misses by and what would have to be confirmed. Do not propose changing the requirement.`,
            kept_requirement: kept.slice(0, 500),
          },
          rationale,
          expected_outcome: 'The work finished with your requirement as it stands.',
        },
      };
    }
    return { kind: 'ask' };
  }
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
  // 20 Nov (Sean, warehouse rerun): "Go stopped to ask whether it should remove an
  // internal editing note from the final package … routine cleanup Go should handle
  // when it has permission to make routine edits." Taking out a note to the user is
  // not polishing: one such pass is made beyond the limit, and what it saves may
  // only lose lines (`onlyRemoves`, checked when the version is saved).
  if (
    !input.allowed.includes('revise_stage') &&
    (screen.verdict === 'routine_choice' || screen.verdict === 'routine_repair' || screen.verdict === 'business_decision') &&
    asksToRemoveNote(input.question) &&
    (input.removalsBeyondLimit ?? 0) < 1
  ) {
    return {
      kind: 'repair',
      move: {
        action_key: 'revise_stage',
        params: {
          instruction: 'Take out the note to the user that is in the work (text addressed to the user about how the work was made, not part of it). Change nothing else: keep every other line exactly as it is.',
          removal_beyond_limit: true,
        },
        rationale: `Instead of asking "${input.question.slice(0, 200)}": it only takes out a note to you that is not part of the work, so I make this one pass although the run has used its edits on this stage, and keep every other line as it is.`,
        expected_outcome: 'The note taken out; nothing else in the work changed.',
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
  // 17 Nov (Sean, Hidden Innovation): "Go described a citation correction as something
  // it could do, then paused after hitting its edit limit and asked me whether to make
  // the correction." The limit is for polishing. A wrong citation, author, figure or
  // date is an error in the text: one such correction is made beyond the limit.
  if (!input.allowed.includes('revise_stage') && CORRECTION.test(`${screen.instruction} ${input.question}`) && (input.correctionsBeyondLimit ?? 0) < 1) {
    return {
      kind: 'repair',
      move: {
        action_key: 'revise_stage',
        params: { instruction: screen.instruction, correction_beyond_limit: true },
        rationale: `${instead} It corrects an error in the text rather than polishing it, so I make this one correction although the run has used its edits on this stage.`,
        expected_outcome: screen.instruction,
      },
    };
  }
  if (!input.allowed.includes('revise_stage')) {
    // 19 Nov (Sean, Scanner Readiness): "used up its edits" was said on a check stage,
    // which is never revised directly, and "move on" on the last stage.
    const why = input.editsCapped ? 'This run has used up its edits on this stage' : 'This stage is not revised directly';
    // 15 Nov (Sean, workshop): with later stages still to write, this became
    // "declare the objective complete", which stopped the run before the email.
    // The work moves on and the question is kept for the user.
    if (input.allowed.includes('advance_stage') && !input.lastStage) {
      return {
        kind: 'repair',
        move: {
          action_key: 'advance_stage',
          params: { set_aside_question: input.question.slice(0, 1000) },
          rationale: `${instead} ${why}, so I move on to the next one and keep this for you.`,
          expected_outcome: 'The next stage worked on, with this question kept for you.',
        },
      };
    }
    // Routine, and this run has used up its edits on the stage: judged as it stands
    // and said, not asked (9 Nov, production: "trim it, or accept it?" over 7% on a
    // hedged target, because "further edits are paused for this run").
    if (!input.allowed.includes('declare_objective_complete')) return { kind: 'ask' };
    return {
      kind: 'repair',
      move: {
        action_key: 'declare_objective_complete',
        params: { set_aside_question: input.question.slice(0, 1000) },
        rationale: `${instead} ${why}, so the work is judged as it stands.`,
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

