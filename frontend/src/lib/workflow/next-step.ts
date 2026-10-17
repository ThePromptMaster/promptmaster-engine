/**
 * The one next action, wherever the user is (17 Oct, Sean, emails 2.2 and 9:
 * "sometimes you gotta switch back between output and then go to summary … I'm
 * trying to make an adjustment in output but then I gotta go press authorize
 * in summary"). Different stages showed "Update affected work and resume",
 * "Apply my changes and let Go continue" and "Apply and update 6 facts", and
 * which one was needed next was not clear. This picks one, and the bar shows
 * it at the top of whichever stage is open. Pure.
 */

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
  if (i.goActive) return { kind: 'working', label: `Go is working${i.goWorkingOn ? ` on ${i.goWorkingOn}` : ''}…`, why: '' };
  if (i.reopenedHere) {
    return {
      kind: 'apply_continue_reopened',
      label: 'Apply and continue',
      why: `Keeps your changes to ${i.reopenedLabel ?? 'this stage'} and has Go recheck what came after it.`,
    };
  }
  if (i.awaitingUpdate.length) {
    const names = i.awaitingUpdate.length <= 3 ? i.awaitingUpdate.join(', ') : `${i.awaitingUpdate.length} stages`;
    return { kind: 'apply_continue', label: 'Apply and continue', why: `${names} ${i.awaitingUpdate.length === 1 ? 'needs' : 'need'} updating after your change; Go does it and carries on.` };
  }
  const paused = i.run && !i.run.ended_at && (i.run.status === 'awaiting_decision' || i.run.status === 'blocked');
  // On the current stage Go's own panel carries its card and Resume: not twice.
  if (!paused || i.onCurrentStage) return null;
  if (i.run!.hasNeed || i.run!.asking) return { kind: 'answer_go', label: "Answer Go's question", why: 'Go is waiting for you on the current stage.' };
  return { kind: 'resume', label: 'Resume', why: 'Go is paused and can carry on from here.' };
}
