import type { WorkflowTemplate } from './types';
/**
 * Words a user can read, for codes the database stores (PM-07).
 *
 * Sean saw "v1 stage_draft" above his giraffe book's objective and could not
 * tell what it meant. The stored values stay as they are — they are
 * provenance (FR-10) and other code keys on them — and are translated only at
 * the point of display.
 */

const OPERATION_LABEL: Record<string, string> = {
  stage_draft: 'AI draft',
  stage_regenerate: 'AI redraft',
  stage_edit: 'Your edit',
  chat_instruct: 'Revised from chat',
  applied_recommendations: 'Suggested fixes applied',
  restore: 'Restored earlier version',
  refine: 'Refined',
  outline_edit: 'Outline edit',
  initial: 'Imported',
  // PM-10: the original core's actions, inside a stage.
  flow_refine_shorter: 'Refined: shorter',
  flow_refine_technical: 'Refined: more technical',
  flow_refine_concrete: 'Refined: more concrete',
  flow_refine_angle: 'Refined: different angle',
  flow_refine_cautious: 'Refined: more cautious',
  flow_drift_alert: 'Realigned to the objective',
  continuation: 'Continued',
  chat_save: 'Saved from the discussion',
  chat_rows: 'Rows changed from the chat',
  literature_lookup: 'Works looked up',
  literature_search: 'Works found by search',
  sandbox_result: 'Run recorded from the sandbox',
  // PM-17: Go mode's own work, kept distinguishable from a button press.
  // PM-22: fixes applied from a stage check or a critique.
  applied_findings: 'Critique applied',
  agent_draft: 'Go mode draft',
  agent_revise: 'Go mode revision',
  // A2: a long-form stage's versions are snapshots of the manuscript.
  long_form_complete: 'Full draft saved',
  agent_outline: 'Go mode outline',
  agent_triage: 'Go mode: routine findings decided',
  manuscript_snapshot: 'Full draft before revision',
  finished_version: 'Finished version',
};

/**
 * Versions the user chose to keep, as against the ones the app produced on
 * the way (C6, Sean 28 Sep item 19: "current, saved, full history"). Saved:
 * an edit, a fix or instruction the user applied, a discussion saved, a
 * restore, a manuscript snapshot, an outline edit, an import. History:
 * drafts, redrafts, refinements, continuations and Go mode's own work.
 */
const SAVED_OPERATIONS = new Set([
  'stage_edit', 'chat_instruct', 'applied_recommendations', 'applied_findings', 'restore', 'outline_edit', 'initial',
  'chat_save', 'chat_rows', 'literature_lookup', 'literature_search', 'sandbox_result', 'long_form_complete', 'manuscript_snapshot', 'finished_version',
]);

export function isSaved(operation: string | null | undefined): boolean {
  return Boolean(operation && SAVED_OPERATIONS.has(operation));
}

/** "AI draft", "Your edit", … — never the raw code. */
export function operationLabel(operation: string | null | undefined): string {
  if (!operation) return 'Draft';
  return OPERATION_LABEL[operation] ?? operation.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * What a version pill means, for its tooltip and screen readers. The "v1"
 * on its own was the other half of Sean's question.
 */
export function versionTitle(versionNumber: number, operation: string | null | undefined): string {
  const what = operationLabel(operation);
  return versionNumber === 1
    ? `Version 1 — ${what}. Every change saves a new version you can go back to.`
    : `Version ${versionNumber} — ${what}. Earlier versions are kept; select one to view or restore it.`;
}

/**
 * What this workflow's finished thing and its parts are called.
 *
 * The finished screen said "Your book is complete" and counted "chapters" for
 * any workflow that drafts in sections — Research included (1 Oct, item 26).
 * Templates published since carry `nouns`; for the versions pinned before
 * that, the outline flag decides: an outline built by hand is a book's, one
 * derived from the stages is a report's.
 */
export function deliverableNouns(template: Pick<WorkflowTemplate, 'nouns' | 'outline_stage' | 'name'>): { deliverable: string; unit: string } {
  if (template.nouns) return template.nouns;
  if (template.outline_stage === 'explicit') return { deliverable: template.name.toLowerCase(), unit: 'chapter' };
  if (template.outline_stage === 'derived') return { deliverable: `${template.name.toLowerCase()} report`, unit: 'section' };
  return { deliverable: 'work', unit: 'section' };
}
