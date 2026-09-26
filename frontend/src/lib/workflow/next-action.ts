/**
 * The one thing to do next on a stage (PM-06, PM-08).
 *
 * Sean, on the Sep 10 call, drafting "a book about giraffes": the stage showed
 * Regenerate, Evaluate this stage and Advance side by side, "there's just a lot
 * of buttons, I don't know exactly which one to press". Every stage now has a
 * single primary action, chosen here, and everything else sits behind "More".
 *
 * Pure, like the rest of the engine: the same state always yields the same
 * suggestion, so the UI can be tested without rendering and the order can be
 * argued about in one place.
 *
 * The order is the workflow a careful user would follow anyway:
 *   unsaved edits  -> save them (nothing else counts until they are saved)
 *   panel step     -> a stage that works through its own panel (the outline
 *                     editor, drafting, revision) names its step, and that is
 *                     the primary — not "Continue anyway" beside it
 *   nothing yet    -> draft it
 *   not checked    -> check it (one model call, and it is the loop's point)
 *   fixes offered  -> apply them
 *   otherwise      -> move on, and say so plainly when nothing needs another
 *                     pass (PM-25).
 */

export type StageActionKind =
  | 'none'
  | 'save'
  | 'draft'
  | 'continue_writing'
  | 'evaluate'
  | 'apply_fixes'
  | 'continue'
  | 'finish'
  | 'panel';

/**
 * The next step a stage's own panel holds: approve the outline, start drafting,
 * apply the findings. Reported by the panel, because only it knows.
 */
export interface PanelStep {
  label: string;
  reason: string;
  /** The panel is working (a draft is running); the stage is busy, not stuck. */
  busy?: boolean;
}

/** What a panel reports upward: its step, and how to take it. */
export interface ReportedPanelStep extends PanelStep {
  run?: () => void;
}

export type PanelStepReporter = (stageId: string, step: ReportedPanelStep | null) => void;

export interface NextActionInput {
  /** The project is finished; nothing is suggested. */
  finished: boolean;
  /** A draft or evaluation is in flight; the stage is busy, not stuck. */
  busy: boolean;
  /** The renderer holds edits that are not yet a version. */
  dirty: boolean;
  /**
   * The stage produces an artifact the model can draft. False for checkpoint
   * stages (Outline approval) and for stages that draft through their own
   * panel (the outline editor, long-form drafting).
   */
  draftable: boolean;
  hasContent: boolean;
  /**
   * The draft stopped before it was finished — the model hit its length limit,
   * or the evaluation judged it incomplete. Finishing it is the real work of
   * the stage (PM-11), so it comes before judging it.
   */
  truncated?: boolean;
  /** The artifact can be scored by the stage evaluator. */
  evaluable: boolean;
  /** The head version has been evaluated. */
  evaluated: boolean;
  /** That evaluation needs nothing: aligned, clear, on topic, no findings. */
  evaluationClean: boolean;
  /**
   * PM-25: the evaluator said no further AI pass is needed, and why. The
   * primary action says so in those words rather than inviting another pass.
   */
  noFurtherPassReason?: string | null;
  /** Pending recommendations that can be applied to the text. */
  applyableFixes: number;
  /** No blocking exit criterion is unmet. */
  canAdvance: boolean;
  /** This is the workflow's last stage. */
  isLast: boolean;
  /** Short label of the stage after this one, for the button. */
  nextLabel: string | null;
  /** The step the stage's own panel is waiting on, if it has one. */
  panelStep?: PanelStep | null;
}

export interface StageAction {
  kind: StageActionKind;
  label: string;
  /** One line under the button saying why this is the next step. */
  reason: string;
}

export function nextStageAction(input: NextActionInput): StageAction {
  if (input.finished) return { kind: 'none', label: '', reason: '' };
  if (input.busy) return { kind: 'none', label: '', reason: 'Working…' };

  if (input.dirty) {
    return {
      kind: 'save',
      label: 'Save changes',
      reason: 'Your edits count once they are saved as a new version.',
    };
  }

  if (input.panelStep?.busy) return { kind: 'none', label: '', reason: 'Working…' };
  if (input.panelStep) {
    return { kind: 'panel', label: input.panelStep.label, reason: input.panelStep.reason };
  }

  if (input.draftable && !input.hasContent) {
    return {
      kind: 'draft',
      label: 'Draft this stage',
      reason: 'Start from a draft you can edit, or write it yourself from More.',
    };
  }

  if (input.draftable && input.hasContent && input.truncated) {
    return {
      kind: 'continue_writing',
      label: 'Continue writing',
      reason: 'The draft stopped before it was finished. This picks up where it left off.',
    };
  }

  if (input.evaluable && input.hasContent && !input.evaluated) {
    return {
      kind: 'evaluate',
      label: 'Check this stage',
      reason: 'One model call scores it against your objective and suggests fixes.',
    };
  }

  if (input.applyableFixes > 0 && !input.evaluationClean) {
    return {
      kind: 'apply_fixes',
      label: input.applyableFixes === 1 ? 'Apply the suggested fix' : `Apply the ${input.applyableFixes} suggested fixes`,
      reason: 'You see the changes before anything is replaced.',
    };
  }

  const clean = input.evaluated && input.evaluationClean;
  const done = input.noFurtherPassReason
    ? `No further AI pass needed — ${input.noFurtherPassReason.replace(/\.$/, '')}.`
    : 'Looks good — nothing here needs another pass.';
  if (input.isLast) {
    return {
      kind: 'finish',
      label: input.canAdvance ? 'Finish project' : 'Finish anyway',
      reason: input.canAdvance
        ? clean
          ? done
          : 'This is the last stage.'
        : 'Some required items are still open — you will be asked why.',
    };
  }

  const to = input.nextLabel ?? 'the next stage';
  return {
    kind: 'continue',
    label: input.canAdvance ? `Continue to ${to}` : `Continue to ${to} anyway`,
    reason: input.canAdvance
      ? clean
        ? done
        : 'Everything this stage needs is done.'
      : 'Some required items are still open — you will be asked why.',
  };
}
