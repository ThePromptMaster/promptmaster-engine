import { EXAMPLE_CARDS, type ExampleKey } from './cards';

export const WORK_ANSWERS = ['investing', 'consulting', 'finance', 'research', 'other'] as const;
export const NEED_ANSWERS = ['memo', 'slides', 'compare', 'numbers'] as const;
export type WorkAnswer = (typeof WORK_ANSWERS)[number];
export type NeedAnswer = (typeof NEED_ANSWERS)[number];

const FOR_WORK: Record<WorkAnswer, Partial<Record<ExampleKey, number>>> = {
  investing: { deal_screening: 3, investment_memo: 3 },
  consulting: { business_analysis: 2, slide_deck: 2 },
  finance: { business_analysis: 3, investment_memo: 1 },
  research: { business_analysis: 2 },
  other: {},
};

const FOR_NEED: Record<NeedAnswer, Partial<Record<ExampleKey, number>>> = {
  memo: { investment_memo: 2, business_analysis: 1 },
  slides: { slide_deck: 4 },
  compare: { deal_screening: 3, business_analysis: 1 },
  numbers: { business_analysis: 3, investment_memo: 1 },
};

/**
 * The examples in the order they suit these answers, for someone who would rather
 * tap than connect an account (the client's call, 4 Nov). No model is asked: it
 * costs nothing, and the same answers always give the same order. Ties keep the
 * catalog's order, so with no answers it is simply the catalog.
 */
export function rankExamples(work?: string, need?: string): ExampleKey[] {
  const score = (key: ExampleKey) =>
    (FOR_WORK[work as WorkAnswer]?.[key] ?? 0) + (FOR_NEED[need as NeedAnswer]?.[key] ?? 0);
  return EXAMPLE_CARDS.map((c, i) => ({ key: c.key, i }))
    .sort((a, b) => score(b.key) - score(a.key) || a.i - b.i)
    .map((c) => c.key);
}
