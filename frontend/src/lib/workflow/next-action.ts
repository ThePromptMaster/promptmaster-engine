import { tr } from '@/lib/i18n/store';
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
 *   not checked    -> check it (one model call, and it is the loop's point) —
 *                     except on a stage that only frames the work, whose
 *                     required items are met: there, move on (see FRAMING_KINDS)
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

/**
 * Artifact kinds that frame the work rather than being it: the objective
 * statement, the research question, the prompt. On 10 Oct a first-time user on
 * Single output met "Check this stage" — one more AI call — as the main button
 * on Input and again on Review, with every required item already met and
 * "move on" under a menu. On these stages the check is offered in More and
 * moving on leads; on every other stage the check still comes first.
 */
export const FRAMING_KINDS: ReadonlySet<string> = new Set(['objective_statement', 'research_question', 'prompt']);

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
  /** The stage frames the work (its artifact kind is in FRAMING_KINDS). */
  framing?: boolean;
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
  /**
   * What the latest check of the draft holds against it (`checkVerdict`): Go
   * will not move on past it, so the bar does not say everything is done.
   */
  checkSays?: string | null;
  /** This is the workflow's last stage. */
  isLast: boolean;
  /**
   * Every box on this stage that only the user can tick is ticked: on the
   * last stage, the user has accepted the work (Sean, 22 Oct: "tick the
   * accept box … then scroll to the bottom and dropdown for 'accept'").
   */
  accepted?: boolean;
  /** Short label of the stage after this one, for the button. */
  nextLabel: string | null;
  /** The step the stage's own panel is waiting on, if it has one. */
  panelStep?: PanelStep | null;
  /** PM-23: the required items still open, by label, for "why this". */
  unmetRequired?: string[];
}

export interface StageAction {
  kind: StageActionKind;
  label: string;
  /** One line under the button saying why this is the next step. */
  reason: string;
  /**
   * PM-23, "why it is recommended": the facts that made this the next step,
   * from the same inputs that chose it — so the explanation cannot disagree
   * with the choice.
   */
  because?: string[];
}

export function nextStageAction(input: NextActionInput): StageAction {
  const action = chooseAction(input);
  return action.kind === 'none' ? action : { ...action, because: because(action.kind, input) };
}

function because(kind: StageActionKind, input: NextActionInput): string[] {
  const open = input.unmetRequired ?? [];
  const openLine = open.length ? tr('na.stillOpen', { items: open.join('; ') }) : tr('na.allMet');
  switch (kind) {
    case 'save':
      return [tr('na.save1'), tr('na.save2')];
    case 'panel':
      return [input.panelStep?.reason ?? tr('na.panel')];
    case 'draft':
      return [tr('na.draft1'), tr('na.draft2')];
    case 'continue_writing':
      return [tr('na.cont1'), tr('na.cont2')];
    case 'evaluate':
      return [
        tr('na.eval1'),
        tr('na.eval2'),
        openLine,
      ];
    case 'apply_fixes':
      return [
        tr('na.fixesWaiting', { count: input.applyableFixes }),
        tr('na.fixes2'),
        tr('na.fixes3'),
      ];
    case 'continue':
    case 'finish':
      return [
        openLine,
        input.noFurtherPassReason
          ? tr('na.noPass', { reason: input.noFurtherPassReason })
          : input.evaluated && input.evaluationClean
            ? tr('na.lastClean')
            : input.evaluated
              ? tr('na.lastDealt')
              : tr('na.notChecked'),
        ...(input.canAdvance ? [] : [tr('na.overrideNote')]),
      ];
    default:
      return [];
  }
}

function chooseAction(input: NextActionInput): StageAction {
  if (input.finished) return { kind: 'none', label: '', reason: '' };
  if (input.busy) return { kind: 'none', label: '', reason: tr('na.working') };

  if (input.dirty) {
    return {
      kind: 'save',
      label: tr('na.saveChanges'),
      reason: tr('na.saveWhy'),
    };
  }

  if (input.panelStep?.busy) return { kind: 'none', label: '', reason: tr('na.working') };
  if (input.panelStep) {
    return { kind: 'panel', label: input.panelStep.label, reason: input.panelStep.reason };
  }

  // Accepted on the last stage: finishing is what is left, whatever a check
  // would still say — the user's acceptance is the decision (22 Oct).
  if (input.isLast && input.accepted && input.hasContent) {
    return {
      kind: 'finish',
      label: input.canAdvance ? tr('na.finish') : tr('na.overrideFinish'),
      reason: input.canAdvance ? tr('na.acceptedFinish') : tr('na.requiredOpen'),
    };
  }

  if (input.draftable && !input.hasContent) {
    return {
      kind: 'draft',
      label: tr('na.draftStage'),
      reason: tr('na.draftWhy'),
    };
  }

  if (input.draftable && input.hasContent && input.truncated) {
    return {
      kind: 'continue_writing',
      label: tr('na.continueWriting'),
      reason: tr('na.continueWhy'),
    };
  }

  if (input.evaluable && input.hasContent && !input.evaluated && !(input.framing && input.canAdvance)) {
    return {
      kind: 'evaluate',
      label: tr('na.check'),
      reason: tr('na.checkWhy'),
    };
  }

  if (input.applyableFixes > 0 && !input.evaluationClean) {
    return {
      kind: 'apply_fixes',
      label: input.applyableFixes === 1 ? tr('na.applyFix') : tr('na.applyFixes', { count: input.applyableFixes }),
      reason: tr('na.applyWhy'),
    };
  }

  const clean = input.evaluated && input.evaluationClean;
  const done = input.noFurtherPassReason
    ? tr('na.noPassDone', { reason: input.noFurtherPassReason.replace(/\.$/, '') })
    : tr('na.looksGood');
  if (input.isLast) {
    return {
      kind: 'finish',
      label: input.canAdvance ? tr('na.finish') : tr('na.overrideFinish'),
      reason: input.canAdvance
        ? clean
          ? done
          : tr('na.lastStage')
        : tr('na.requiredOpen'),
    };
  }

  const to = input.nextLabel ?? tr('na.theNextStage');
  return {
    kind: 'continue',
    label: input.canAdvance ? tr('na.continueTo', { stage: to }) : tr('na.overrideTo', { stage: to }),
    reason: input.canAdvance
      ? input.checkSays
        ? tr('na.checkSays', { says: input.checkSays })
        : clean
        ? done
        : tr('na.allDone')
      : tr('na.requiredOpen'),
  };
}
