import { actionLabel, AWAIT_SECTIONS_STEP, INTERPRET_STEP, ROUTINE_DEFAULT_STEP, USER_ANSWER_STEP, type StepStage } from '@/lib/agent/actions';
import { DICTIONARIES, translate } from './translate';
import type { Locale } from './locales';
import { getLocale, tr } from './store';
import type { MessageKey } from './messages/en';

/**
 * Go's moves by name, in the interface's language (client, 21 Oct). The
 * registry in `lib/agent/actions.ts` keeps the English names the planner and
 * the Python registry share; this is only what the page shows.
 */
const SPECIAL: Record<string, MessageKey> = {
  [INTERPRET_STEP]: 'goAction.interpret',
  [USER_ANSWER_STEP]: 'goAction.userAnswer',
  [AWAIT_SECTIONS_STEP]: 'goAction.awaitSections',
  [ROUTINE_DEFAULT_STEP]: 'goAction.routineDefault',
};

export function shownActionLabel(key: string, locale: Locale = getLocale()): string {
  const k = SPECIAL[key] ?? `goAction.${key}`;
  return k in DICTIONARIES[locale] ? translate(locale, k) : actionLabel(key);
}

/** As `stepLabel`: a recheck of a measured requirement says so. */
export function shownStepLabel(step: { action_key: string; params?: Record<string, unknown> | null }): string {
  if (step.action_key === 'recheck_stage' && step.params?.measured) return tr('goAction.measured');
  return shownActionLabel(step.action_key);
}

/** As `stepActionLabel`: moving on from the last stage completes it. */
export function shownStepActionLabel(key: string, stage?: StepStage | null): string {
  if (key === 'advance_stage' && stage && !stage.transitions.default_next) return tr('goAction.lastComplete');
  return shownActionLabel(key);
}
