/**
 * The one next action, wherever the user is (17 Oct, Sean, emails 2.2 and 9:
 * "sometimes you gotta switch back between output and then go to summary … I'm
 * trying to make an adjustment in output but then I gotta go press authorize
 * in summary"). Different stages showed "Update affected work and resume",
 * "Apply my changes and let Go continue" and "Apply and update 6 facts", and
 * which one was needed next was not clear. This picks one, and the bar shows
 * it at the top of whichever stage is open. Pure.
 */

import { tr } from '@/lib/i18n/store';
import { NEXT_STEP_LABELS } from './stage-controls';

export type NextActionKind = 'apply_continue_reopened' | 'apply_continue' | 'answer_go' | 'resume' | 'working';

export interface NextAction {
  kind: NextActionKind;
  /** The button, or for `working` the status line. */
  label: string;
  /** One short sentence: why this is next. */
  why: string;
}

export interface NextActionInput {
  finalized: boolean;
  /** The user may change the work (not a read-only share). */
  canAct: boolean;
  /** A change waits on a "which takes priority?" answer: its own notice is the next action. */
  heldChanges: number;
  /** The open stage is one the user reopened, not the project's current stage. */
  reopenedHere: boolean;
  reopenedLabel?: string;
  /** Stages a change marked for a recheck, by label. */
  awaitingUpdate: readonly string[];
  goActive: boolean;
  goWorkingOn?: string;
  /** The live run, if it is paused. */
  run: { status: string; ended_at: string | null; hasNeed: boolean; asking: boolean } | null;
  /** The open stage is the project's current one, where Go's own panel shows its card and Resume. */
  onCurrentStage: boolean;
}

export function nextAction(i: NextActionInput): NextAction | null {
  if (i.finalized || !i.canAct || i.heldChanges > 0) return null;
  if (i.goActive) return { kind: 'working', label: i.goWorkingOn ? tr('ns.goWorkingOn', { what: i.goWorkingOn }) : tr('ns.goWorking'), why: '' };
  if (i.reopenedHere) {
    return {
      kind: 'apply_continue_reopened',
      label: NEXT_STEP_LABELS.applyContinue,
      why: tr('ns.keeps', { stage: i.reopenedLabel ?? tr('ns.thisStage') }),
    };
  }
  // While Go waits, Go's own controls are the next step, and only they (18 Oct,
  // pilot: "Apply and continue" sat above the Go strip's "Answer Go's
  // question"). Its question comes first; its Resume also updates work a
  // change reopened, before anything else.
  const paused = Boolean(i.run && !i.run.ended_at && (i.run.status === 'awaiting_decision' || i.run.status === 'blocked'));
  const asking = paused && Boolean(i.run!.hasNeed || i.run!.asking);
  // On the current stage Go's own panel carries its card and Resume: not twice.
  if (paused && i.onCurrentStage) return null;
  if (asking) return { kind: 'answer_go', label: NEXT_STEP_LABELS.answerGo, why: tr('ns.goWaiting') };
  if (i.awaitingUpdate.length) {
    const names = i.awaitingUpdate.length <= 3 ? i.awaitingUpdate.join(', ') : tr('ns.stages', { count: i.awaitingUpdate.length });
    return { kind: 'apply_continue', label: NEXT_STEP_LABELS.applyContinue, why: tr('ns.needUpdate', { count: i.awaitingUpdate.length, names }) };
  }
  if (!paused) return null;
  return { kind: 'resume', label: NEXT_STEP_LABELS.resume, why: tr('ns.paused') };
}
