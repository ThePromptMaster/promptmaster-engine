/**
 * Questions the side chat offers before the user types. Pure; no model call.
 *
 * The client wanted a chat that "knows when it's directed", like Copilot
 * (3 Oct call): one that opens on the question the page is posing rather than
 * on a blank box. Derived from what the stage holds, so the same page always
 * offers the same questions, and at most three.
 */

import type { StageRenderer } from './types';
import { translate, type Vars } from '@/lib/i18n/translate';

/** The words for a key in the interface's language; English unless the caller says otherwise. */
export type Say = (key: string, vars?: Vars) => string;
const english: Say = (key, vars) => translate('en', key, vars);

export interface StarterInput {
  renderer: StageRenderer;
  stageLabel: string;
  hasContent: boolean;
  /** Rows on a table stage nobody has decided yet. */
  openRows: number;
  /** Labels of required exit criteria still open. */
  requiredOpen: string[];
  nextStageLabel: string | null;
}

export const STARTERS_MAX = 3;

/** In the interface's language (24 Oct: they were the one part of the side chat left in English). */
export function starterQuestions(input: StarterInput, t: Say = english): string[] {
  const { renderer, stageLabel, hasContent, openRows, requiredOpen, nextStageLabel } = input;
  const out: string[] = [];

  if (!hasContent) {
    out.push(t('starter.produce', { stage: stageLabel }));
  } else if (renderer === 'review' || renderer === 'list') {
    if (openRows > 0) {
      out.push(t('starter.openRows', { count: openRows }));
      out.push(t('starter.summarise'));
    } else {
      out.push(t('starter.tableWrong'));
    }
  } else if (renderer === 'outline') {
    out.push(t('starter.outlineCovers'));
    out.push(t('starter.outlineWeakest'));
  } else if (renderer === 'long_form') {
    out.push(t('starter.chapterWork'));
    out.push(t('starter.chaptersContradict'));
  } else {
    out.push(t('starter.weakest'));
    out.push(t('starter.objective'));
  }

  // The open criterion is said as not met: "(An output exists)" beside a chat
  // saying "There is no draft here yet" read as a contradiction (14 Oct, Sean).
  // With nothing drafted, the first question already asks what it should hold.
  const open = hasContent ? requiredOpen : requiredOpen.filter((l) => !/(?:output|draft|artifact|text).*exists?/i.test(l));
  if (open.length > 0) {
    // Lower-cased to run on in English ("Not yet: an output exists"); other languages keep the label as it is.
    const criterion = t === english && !/^I\b/.test(open[0]) ? open[0][0].toLowerCase() + open[0].slice(1) : open[0];
    out.push(t('starter.stillNeeds', { criterion }));
  } else if (nextStageLabel) {
    out.push(t('starter.ready', { stage: nextStageLabel }));
  }

  return out.slice(0, STARTERS_MAX);
}
