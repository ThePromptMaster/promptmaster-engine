/**
 * The buttons that are on a stage's page now. Pure.
 *
 * Go was told to "name that button exactly" and given no buttons: it wrote
 * "if your interface has that control, press Generate the outline/results
 * artifact" on a page with no such thing (2 Oct, item 10). This is the list
 * it is given instead, and the page draws its own labels from the same
 * functions — the stage bar's menu from `transitionEntries`, the lookup and
 * data buttons from the labels below — so what Go may name and what the
 * user can press cannot drift apart.
 *
 * These are the user's controls. Go's own moves are in `lib/agent/actions.ts`.
 */

import { tr } from '@/lib/i18n/store';
import type { StageAction } from './next-action';
import type { TransitionOption } from './engine';

export type ControlPlace = 'stage_bar' | 'more_menu' | 'checklist' | 'data_panel' | 'table' | 'go_panel' | 'next_step' | 'above_work';

export interface StageControl {
  id: string;
  /** The words on the button, exactly. */
  label: string;
  place: ControlPlace;
}

/** Where a control is, in words for the user. */
/**
 * The next-step bar's buttons, at the top of every stage (17 Oct, N4b). Named
 * here like every other page button, so Go and the page use the same words.
 */
export const NEXT_STEP_LABELS = {
  // Read when used, in the interface's language (client, 21 Oct): the page and Go name the same words.
  get applyContinue() {
    return tr('controls.applyContinue');
  },
  get answerGo() {
    return tr('controls.answerGo');
  },
  get resume() {
    return tr('controls.resume');
  },
};

export const PLACE_WORDS: Record<ControlPlace, string> = {
  stage_bar: 'the main button at the bottom of the stage',
  more_menu: 'under "More" at the bottom of the stage',
  checklist: 'in the "To finish this stage" checklist',
  data_panel: 'in the Data panel',
  table: 'above the table',
  go_panel: 'in the Go mode panel',
  next_step: 'in the bar at the top of the stage',
  above_work: "just above the stage's work",
};

/**
 * Go's own panel, as it reads now (25 Oct, Sean: "the system has sometimes
 * referenced buttons that don't actually exist", and the chat's "press Resume"
 * was rewritten as "no button" although Resume was on the screen). The main
 * button's word follows the same rule the panel uses.
 */
export function goPanelControls(run: {
  status: string;
  ended_at: string | null;
  pending: boolean;
  /** The used-up window can be continued as it was (same policy and size). */
  continuable: boolean;
  /** Go's question card is shown. */
  asking: boolean;
} | null): StageControl[] {
  const live = Boolean(run && !run.ended_at);
  const canResume = live && (run!.status === 'blocked' || run!.status === 'awaiting_decision') && !run!.pending;
  const canContinue = Boolean(run && run.status === 'budget_exhausted' && run.continuable);
  const main = canResume ? tr('go.resume') : canContinue ? tr('go.continue') : tr('go.go');
  return [
    { id: 'go-main', label: main, place: 'go_panel' },
    ...(run?.asking ? [
      { id: 'go-answer', label: tr('qp.answerContinue'), place: 'go_panel' as const },
      { id: 'go-best', label: tr('qp.best'), place: 'go_panel' as const },
    ] : []),
  ];
}

/** Drafting's way back into the outline (Sean, 25 Oct: "can you go back and add sections or chapters?"). */
export const addSectionsLabel = () => tr('controls.addSections');

export const ATTACH_DATA_LABEL = 'Attach a data file';
export const ADD_IMAGES_LABEL = 'Add images';
export const lookupLabel = (noun: string) => tr('controls.lookup', { noun });
/** The one click that makes PromptMaster's proposed statuses the user's (3 Oct). */
export const confirmProposalsLabel = (n: number) => (n === 1 ? tr('controls.confirmOne') : tr('controls.confirmMany', { count: n }));

export interface MenuEntry {
  id: string;
  label: string;
  icon: string;
}

const isTransition = (primary: StageAction | undefined) => primary?.kind === 'continue' || primary?.kind === 'finish';

/** The transitions the stage bar offers under More, in the order it shows them. */
export function transitionEntries(input: {
  primary?: StageAction;
  options: readonly TransitionOption[];
  nextStageLabel?: string | null;
  /** A stage's name as the page shows it, for "Go back to …"; the option's own label otherwise. */
  stageName?: (stageId: string) => string | undefined;
}): MenuEntry[] {
  const advance = input.options.find((o) => o.kind === 'advance' || o.kind === 'finish');
  const skip = input.options.find((o) => o.kind === 'skip');
  const returns = input.options.filter((o) => o.kind === 'return');
  const to = input.nextStageLabel ?? tr('na.theNextStage');
  return [
    // The transition, when something else leads: moving on is always one
    // click away, never hidden, just not the suggestion.
    ...(!isTransition(input.primary) && advance
      ? [{
          id: 'advance',
          label: advance.kind === 'finish'
            ? (advance.requiresNote ? tr('na.overrideFinish') : tr('na.finish'))
            : advance.requiresNote ? tr('na.overrideTo', { stage: to }) : tr('na.continueTo', { stage: to }),
          icon: 'arrow_forward',
        }]
      : []),
    ...(skip ? [{ id: 'skip', label: tr('controls.skip'), icon: 'redo' }] : []),
    ...returns.map((option) => ({
      id: `return-${option.toStageId}`,
      label: tr('controls.goBackTo', { stage: (option.toStageId ? input.stageName?.(option.toStageId) : undefined) ?? option.label.replace(/^Return to /, '') }),
      icon: 'undo',
    })),
  ];
}

export function stageControls(input: {
  primary?: StageAction;
  /** The stage's own actions under More (Regenerate, Check again, …), as the workspace builds them. */
  more: readonly { id: string; label: string; disabled?: boolean }[];
  options: readonly TransitionOption[];
  nextStageLabel?: string | null;
  stageName?: (stageId: string) => string | undefined;
  /** Approvals the user has not given yet: each is a box they can tick. */
  openApprovals?: readonly { id: string; label: string }[];
  /** The stage's table can look its rows up (`schema.lookup.noun`). */
  lookupNoun?: string | null;
  /** The Data panel is on the page. */
  dataPanel?: boolean;
  /** Rows whose proposed status can be confirmed as it stands. */
  proposals?: number;
  /** Rows with no status or proposal yet, on a table that takes proposals. */
  proposeRows?: boolean;
  /** The next-step bar's button, when it shows one. */
  nextStep?: string | null;
  /** Go's panel, from `goPanelControls`. */
  go?: readonly StageControl[];
  /** A drafting stage whose outline can be reopened to add chapters or sections. */
  addSections?: boolean;
}): StageControl[] {
  const controls: StageControl[] = [];
  if (input.primary && input.primary.kind !== 'none' && input.primary.label) {
    controls.push({ id: `primary-${input.primary.kind}`, label: input.primary.label, place: 'stage_bar' });
  }
  for (const m of input.more) {
    if (!m.disabled) controls.push({ id: m.id, label: m.label, place: 'more_menu' });
  }
  for (const t of transitionEntries(input)) controls.push({ id: t.id, label: t.label, place: 'more_menu' });
  for (const c of input.openApprovals ?? []) controls.push({ id: `tick-${c.id}`, label: c.label, place: 'checklist' });
  if (input.proposeRows) controls.push({ id: 'propose-statuses', label: tr('controls.propose'), place: 'table' });
  if (input.proposals) controls.push({ id: 'confirm-proposals', label: confirmProposalsLabel(input.proposals), place: 'table' });
  if (input.lookupNoun) controls.push({ id: 'lookup', label: lookupLabel(input.lookupNoun), place: 'table' });
  if (input.dataPanel) controls.push({ id: 'attach-data', label: tr('data.attachData'), place: 'data_panel' });
  if (input.addSections) controls.push({ id: 'add-sections', label: addSectionsLabel(), place: 'above_work' });
  if (input.nextStep) controls.push({ id: 'next-step', label: input.nextStep, place: 'next_step' });
  for (const c of input.go ?? []) controls.push(c);
  // One label, one entry: the planner names a button by its words.
  const seen = new Set<string>();
  return controls.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));
}

/** The control a planner named, if it is really on the page. */
export function findControl(controls: readonly StageControl[] | undefined, named: unknown): StageControl | null {
  if (typeof named !== 'string' || !named.trim()) return null;
  const want = named.trim().toLowerCase();
  return controls?.find((c) => c.id.toLowerCase() === want || c.label.toLowerCase() === want) ?? null;
}
