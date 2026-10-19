/**
 * A second round of review fixes is carried forward, not offered as another
 * trip back. Pure.
 *
 * 19 Oct, production (FIELDGUIDE copy): Go went back to Output to merge the
 * ten fixes the Final review accepted, reviewed again, found seven newer fixes
 * against the merged version, and asked to go back once more. Every review can
 * find something, so the question can come round for as long as the user keeps
 * answering it.
 *
 * The rule: once a review stage has sent the work back (in this run or an
 * earlier one), the newer
 * fixes it accepts under the routine-decision policy are carried forward —
 * deferred on the review with the reason, and named when Go finishes
 * (`deferredNotBlocking`) — instead of another return.
 * Not carried, and still asked:
 * - a fix the user accepted themselves (they decided it should be made);
 * - a fix that says a requirement is unmet or is major: carried forward, it
 *   would hold "Objective met" up anyway (`carriedForwardUnmet`).
 * Under "ask me", every round is still asked.
 */

import type { ExecutionPolicy, AgentStep } from '@/types/agent';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { RoutineDecisions } from '@/types/project';
import type { StageItem, StageItemSchema } from '@/lib/workflow/stage-artifact';
import { carriedForwardUnmet, parseItems, positiveVerdict } from '@/lib/workflow/stage-artifact';

/** A question, or a return, that is about going back to apply fixes the review accepted. */
const MERGE_ASK = /\b(?:go(?:ing)? back|return(?:ing)?|merge[ds]?)\b/i;
const ACCEPTED = /\baccept(?:ed|s)?\b/i;

export const CARRY_REASON = 'Carried forward: a newer fix from a later review round. Go already merged one round of accepted fixes, so it is left open here instead of going back again. Accept it to have it applied.';

export interface NewerFixes {
  /** The review's rows with the newer fixes marked "Carry forward" under the routine-decision policy. */
  items: StageItem[];
  /** The rows carried. */
  carried: StageItem[];
  /** How many times this stage has already sent the work back in this run. */
  rounds: number;
}

export function carryNewerFixes(args: {
  question: string;
  isReviewStage: boolean;
  stageId: string;
  items: readonly StageItem[];
  schema: StageItemSchema;
  /** This run's steps. */
  steps: readonly Pick<AgentStep, 'stage_id' | 'action_key' | 'status' | 'started_at'>[];
  /**
   * The project's events: a return made in an earlier run counts too. Each
   * Resume starts a new run, and on 19 Oct (FIELDGUIDE copy) the round merged
   * before a block was forgotten, so Go asked to go back a third time.
   */
  events?: readonly Pick<WorkflowEvent, 'type' | 'stage_id' | 'created_at'>[];
  /** The review stage's versions, oldest first. */
  versions: readonly { content: string; created_at: string }[];
  policy: ExecutionPolicy;
  routine: RoutineDecisions;
}): NewerFixes | null {
  const { question, items, schema } = args;
  if (!args.isReviewStage || args.policy !== 'autonomous' || args.routine !== 'handle') return null;
  if (!MERGE_ASK.test(question) || !ACCEPTED.test(question)) return null;

  const inRun = args.steps.filter((s) => s.stage_id === args.stageId && s.action_key === 'return_to_stage' && s.status === 'succeeded').map((s) => s.started_at);
  const logged = (args.events ?? []).filter((e) => e.type === 'stage_returned' && e.stage_id === args.stageId).map((e) => e.created_at);
  const returns = logged.length > inRun.length ? logged : inRun;
  if (!returns.length) return null;
  const lastReturn = returns.reduce((a, b) => (a > b ? a : b));

  // The rows the review held when it last sent the work back: that round was merged.
  const before = [...args.versions].reverse().find((v) => v.created_at <= lastReturn);
  const merged = new Set((parseItems(before?.content) ?? []).map((i) => i.id));
  if (!merged.size) return null;

  const newer = items.filter((i) => i.status === 'accepted' && !merged.has(i.id) && !positiveVerdict(i));
  if (!newer.length) return null;
  // The user's own acceptance is theirs to have applied.
  if (newer.some((i) => i.status_source === 'user')) return null;

  const asCarried = (i: StageItem): StageItem => ({ ...i, status: 'deferred', status_source: 'policy', reason: CARRY_REASON });
  // A fix that says a requirement is unmet still asks: carried, it would hold the objective up.
  if (newer.some((i) => carriedForwardUnmet([asCarried(i)], schema).length)) return null;

  const ids = new Set(newer.map((i) => i.id));
  return {
    items: items.map((i) => (ids.has(i.id) ? asCarried(i) : i)),
    carried: newer.map(asCarried),
    rounds: returns.length,
  };
}

/** "Carried forward: 7 newer fixes from the second review, …" */
export function describeCarried(n: NewerFixes): string {
  const count = n.carried.length;
  const round = n.rounds === 1 ? 'second' : n.rounds === 2 ? 'third' : `${n.rounds + 1}th`;
  return `Carried forward: ${count} newer fix${count === 1 ? '' : 'es'} from the ${round} review, left open on the review instead of going back again. Accept any of them to have it applied.`;
}
