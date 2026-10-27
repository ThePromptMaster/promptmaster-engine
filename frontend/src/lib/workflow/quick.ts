import { deliverableStage } from './engine';
import type { WorkflowTemplate } from './types';

/**
 * Quick answer → the full process (Sean, 26 Oct: "a clear button to take that
 * same work into the full PromptMaster process … Everything carries over so
 * you're building on what you already made").
 *
 * Pure: what the switch writes is decided here, and `take-full-process.tsx`
 * only performs it.
 */

/** A project on the Quick answer workflow, which can be taken into a full one. */
export function isQuickAnswer(template: Pick<WorkflowTemplate, 'key'>): boolean {
  return template.key === 'quick';
}

/** How much of the answer goes to the workflow designer and the setup. */
const ANSWER_FOR_DESIGN = 4_000;

/**
 * What the designer and the setup are told: the ask, and the answer so far,
 * so the workflow fits the work already made rather than the ask alone.
 */
export function switchBrief(objective: string, answer: string, max = 8_000): string {
  const so_far = answer.trim() ? `The answer so far (keep building on it):\n${answer.trim().slice(0, ANSWER_FOR_DESIGN)}` : '';
  return [objective.trim(), so_far].filter(Boolean).join('\n\n').slice(0, max);
}

/**
 * Where the answer goes in the new workflow: the stage that holds its
 * deliverable, when that is a single draft. A manuscript (`long_form`) is
 * written section by section, so the answer cannot stand as its first
 * version; it stays readable on the Answer stage's history instead.
 */
export function carryTarget(template: WorkflowTemplate): { id: string; label: string } | null {
  const stage = deliverableStage(template);
  return stage && stage.renderer === 'prose' ? { id: stage.id, label: stage.label } : null;
}
