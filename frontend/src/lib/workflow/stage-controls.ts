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

import type { StageAction } from './next-action';
import type { TransitionOption } from './engine';

export type ControlPlace = 'stage_bar' | 'more_menu' | 'checklist' | 'data_panel' | 'table';

export interface StageControl {
  id: string;
  /** The words on the button, exactly. */
  label: string;
  place: ControlPlace;
}

/** Where a control is, in words for the user. */
export const PLACE_WORDS: Record<ControlPlace, string> = {
  stage_bar: 'the main button at the bottom of the stage',
  more_menu: 'under "More" at the bottom of the stage',
  checklist: 'in the "To finish this stage" checklist',
  data_panel: 'in the Data panel',
  table: 'above the table',
};

export const ATTACH_DATA_LABEL = 'Attach a data file';
export const lookupLabel = (noun: string) => `Look up these ${noun}`;

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
}): MenuEntry[] {
  const advance = input.options.find((o) => o.kind === 'advance' || o.kind === 'finish');
  const skip = input.options.find((o) => o.kind === 'skip');
  const returns = input.options.filter((o) => o.kind === 'return');
  const to = input.nextStageLabel ?? 'the next stage';
  return [
    // The transition, when something else leads: moving on is always one
    // click away, never hidden, just not the suggestion.
    ...(!isTransition(input.primary) && advance
      ? [{
          id: 'advance',
          label: advance.kind === 'finish'
            ? (advance.requiresNote ? 'Override and finish' : 'Finish project')
            : advance.requiresNote ? `Override and continue to ${to}` : `Continue to ${to}`,
          icon: 'arrow_forward',
        }]
      : []),
    ...(skip ? [{ id: 'skip', label: 'Skip this stage', icon: 'redo' }] : []),
    ...returns.map((option) => ({
      id: `return-${option.toStageId}`,
      label: option.label.replace(/^Return to/, 'Go back to'),
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
  /** Approvals the user has not given yet: each is a box they can tick. */
  openApprovals?: readonly { id: string; label: string }[];
  /** The stage's table can look its rows up (`schema.lookup.noun`). */
  lookupNoun?: string | null;
  /** The Data panel is on the page. */
  dataPanel?: boolean;
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
  if (input.lookupNoun) controls.push({ id: 'lookup', label: lookupLabel(input.lookupNoun), place: 'table' });
  if (input.dataPanel) controls.push({ id: 'attach-data', label: ATTACH_DATA_LABEL, place: 'data_panel' });
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
