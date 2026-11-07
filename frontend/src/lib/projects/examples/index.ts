import { templateFromDesign, type DesignedWorkflow } from '@/lib/workflow/custom';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { ModeType } from '@/types';

import { BUSINESS_ANALYSIS } from './business-analysis';
import type { ExampleKey } from './cards';
import { DEAL_SCREENING } from './deal-screening';
import { INVESTMENT_MEMO } from './investment-memo';
import { MEETING_BRIEFING } from './meeting-briefing';
import { FINISHED_RESULTS, type FinishedResult } from './results';
import { SLIDE_DECK } from './slide-deck';

/**
 * A curated example: a workflow written by hand, in the form the workflow
 * designer returns, with invented material to try it on (the client's call,
 * 4 Nov: testers are not authors or researchers, and "we can make anything" is
 * not a menu).
 *
 * It takes the path every designed project takes (`templateFromDesign`,
 * `validateTemplate`, an unlisted `publishUserTemplate`), so nothing downstream
 * learns it is an example, and no workflow picker fills up with them. Everything
 * here is English, as prompts are; the screen shows the dictionary's words for
 * the stages (`lib/i18n/templates.ts`). The sample material stays in English.
 */
export interface Example {
  key: ExampleKey;
  slug: string;
  icon: string;
  design: DesignedWorkflow;
  project: {
    title: string;
    objective: string;
    audience: string;
    constraints: string;
    output_format: string;
    context: string;
    mode: ModeType;
    /**
     * Set where a run on the default model cost more than about $3 (6 Nov, production: the
     * memo $4 or more). An example is a demonstration; own work keeps the default.
     */
    model?: string;
  };
  /** The first stage, already written, so trying the sample costs nothing until a press. */
  prepared: string;
  /** Data files the project starts with. */
  files?: { name: string; text: string }[];
}

/** An example with what a real run of it produced, for its preview page. */
export function resultOf(example: Pick<Example, 'key'>): FinishedResult | undefined {
  return FINISHED_RESULTS[example.key];
}

export const EXAMPLES: readonly Example[] = [DEAL_SCREENING, INVESTMENT_MEMO, BUSINESS_ANALYSIS, SLIDE_DECK, MEETING_BRIEFING];

export function exampleBySlug(slug: string): Example | undefined {
  return EXAMPLES.find((e) => e.slug === slug);
}

/** `suffix` is what makes the key this user's own; RLS admits `custom_` keys only. */
export function exampleWorkflow(example: Example, suffix: string, { own = false }: { own?: boolean } = {}): WorkflowTemplate {
  // On the user's own work there is no sample to offer.
  const design = own
    ? { ...example.design, stages: example.design.stages.map((stage) => ({ ...stage, offered_batch: undefined })) }
    : example.design;
  return templateFromDesign(design, `ex_${example.key}_${suffix}`);
}

/** The first rows of a data file, for the preview. */
export function csvPreview(text: string, rows = 6): { header: string[]; rows: string[][]; more: number } {
  const lines = text.trim().split('\n').map((l) => l.split(','));
  const body = lines.slice(1);
  return { header: lines[0] ?? [], rows: body.slice(0, rows), more: Math.max(0, body.length - rows) };
}
