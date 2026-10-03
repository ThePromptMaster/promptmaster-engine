/**
 * Questions the side chat offers before the user types. Pure; no model call.
 *
 * The client wanted a chat that "knows when it's directed", like Copilot
 * (3 Oct call): one that opens on the question the page is posing rather than
 * on a blank box. Derived from what the stage holds, so the same page always
 * offers the same questions, and at most three.
 */

import type { StageRenderer } from './types';

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

export function starterQuestions(input: StarterInput): string[] {
  const { renderer, stageLabel, hasContent, openRows, requiredOpen, nextStageLabel } = input;
  const out: string[] = [];

  if (!hasContent) {
    out.push(`What should the ${stageLabel} stage produce for this project?`);
  } else if (renderer === 'review' || renderer === 'list') {
    if (openRows > 0) {
      out.push(`Which of the ${openRows} open ${openRows === 1 ? 'row matters' : 'rows matter'} most, and why?`);
      out.push('Summarise what still needs my decision here.');
    } else {
      out.push('Is anything in this table missing or wrong?');
    }
  } else if (renderer === 'outline') {
    out.push('Does this outline cover everything the objective promises?');
    out.push('Which section is weakest or most out of place?');
  } else if (renderer === 'long_form') {
    out.push('Which chapter needs the most work, and why?');
    out.push('Do the chapters contradict each other anywhere?');
  } else {
    out.push('What is the weakest part of this draft?');
    out.push('Does this still serve the objective?');
  }

  if (requiredOpen.length > 0) {
    out.push(`What does this stage still need from me? (${requiredOpen[0]})`);
  } else if (nextStageLabel) {
    out.push(`Is this ready to move on to ${nextStageLabel}?`);
  }

  return out.slice(0, STARTERS_MAX);
}
