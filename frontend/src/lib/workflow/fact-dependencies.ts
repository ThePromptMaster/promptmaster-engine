/**
 * Which finished work used a fact (7 Oct, L-52).
 *
 * A changed fact used to reopen whatever one model call judged had relied on
 * it — whole stages, named by a summary. When a fact is changed or taken out,
 * what used it can be found in the text itself: the sentences that state its
 * figures, or most of its words. Those stages are reopened, each with the
 * sentence that used the old value, and nothing else is. No model call; the
 * repair is told the exact claim to correct.
 *
 * A fact that is only added has no old value to find; whether it matters to
 * work that never mentioned it is still a judgment (`assess-change`).
 */

import { factValues } from './fact-values';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const WORD = /[a-z]{5,}/g;
/** A fact without figures is used by a sentence holding this share of its longer words. */
const WORD_SHARE = 0.6;

function sentences(text: string): string[] {
  return text
    .replace(/\\n|\n/g, ' \n ')
    // Not after an abbreviated month: "Nov. 12" is one date, not two sentences.
    .split(/(?<=[.!?;])(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)\s+|\s*\n\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function numbers(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, '')).filter((n) => n.length > 0);
}

/** The first sentence of `text` that uses the fact, or null. */
export function sentenceUsingFact(text: string, statement: string): string | null {
  // A date or an amount of money is matched however it is written ("Nov 12",
  // "12 November", "$12.00"), and on its own: "launches Nov 12" uses "Launch
  // date: November 12, 2026" without repeating the year (8 Oct, TeamNotes).
  const distinctive = factValues(statement);
  if (distinctive.dates.length || distinctive.money.length) {
    for (const sentence of sentences(text)) {
      const found = factValues(sentence);
      if (distinctive.dates.some((d) => found.dates.includes(d)) || distinctive.money.some((m) => found.money.includes(m))) {
        return sentence.slice(0, 300);
      }
    }
    return null;
  }
  const figures = numbers(statement);
  const words = [...new Set(statement.toLowerCase().match(WORD) ?? [])];
  for (const sentence of sentences(text)) {
    const plain = sentence.replace(/,/g, '');
    const lower = sentence.toLowerCase();
    if (figures.length) {
      // Every figure of the fact, and at least one of its words, so "7" alone is not a match.
      if (figures.every((n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(plain)) && (words.length === 0 || words.some((w) => lower.includes(w)))) {
        return sentence.slice(0, 300);
      }
    } else if (words.length >= 2 && words.filter((w) => lower.includes(w)).length >= Math.ceil(words.length * WORD_SHARE)) {
      return sentence.slice(0, 300);
    }
  }
  return null;
}

export interface StageText {
  stage_id: string;
  label: string;
  text: string;
}

/** The finished stages that used any of the removed facts, each with the sentence that did. */
export function stagesUsingFacts(removed: readonly string[], stages: readonly StageText[]): { stage_id: string; reason: string }[] {
  const out: { stage_id: string; reason: string }[] = [];
  for (const stage of stages) {
    for (const fact of removed) {
      const used = sentenceUsingFact(stage.text, fact);
      if (used) {
        out.push({ stage_id: stage.stage_id, reason: `It states "${fact}", which changed: "${used}"` });
        break;
      }
    }
  }
  return out;
}

/** The fact statements in a facts text (`factsText`): one per "- " line. */
export function statementsOf(factsText: string): string[] {
  return factsText
    .split('\n')
    .map((l) => l.replace(/^- (Requirement: )?/, '').trim())
    .filter(Boolean);
}
