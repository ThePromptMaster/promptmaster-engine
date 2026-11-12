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
  const draft = answer.trim();
  // Only the opening of a long draft fits here, and it has to say so. Shown cut
  // with no word about it, the setup read the draft as unfinished and wrote
  // "it stops partway through Day 4, so continue from there" into the project's
  // constraints; every stage after was told to continue a draft that was whole
  // (12 Nov, production).
  const cut = draft.length > ANSWER_FOR_DESIGN;
  const so_far = draft
    ? `A first draft of the whole piece already exists${cut ? ' (it is finished; only its opening fits here)' : ''}. Build on it:\n` +
      draft.slice(0, ANSWER_FOR_DESIGN) +
      (cut ? '\n[The draft goes on from here to its end. It is complete, not cut off: nothing has to be continued or supplied.]' : '')
    : '';
  // The note about the cut outranks the last lines of the opening when room is short.
  const head = objective.trim();
  return [head, so_far].filter(Boolean).join('\n\n').slice(0, Math.max(max, head.length + so_far.length));
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
