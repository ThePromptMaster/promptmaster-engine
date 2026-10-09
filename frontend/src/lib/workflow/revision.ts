/**
 * What a Revision or Editing stage applies to the manuscript.
 *
 * Those stages are long-form stages with no manuscript of their own: they
 * rewrite the chapters drafting produced. Until this existed they re-showed the
 * drafting panel — "3 of 3 sections written · Resume drafting" — with no way to
 * act on what Continuity, Critique or Fact-check had found, although the
 * template's own brief says "apply the accepted findings and only those".
 *
 * Pure: the findings are read from the review stages between the previous
 * long-form stage and this one, so Revision gets Continuity's and Editing gets
 * Critique's and Fact-check's. Nothing here is workflow-specific.
 */

import type { StageArtifactBundle } from './digest';
import { effectiveRenderer, itemSchemaFor, parseItems } from './stage-artifact';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from './types';
import { sectionRecords } from './derived-outline';

export interface RevisionFinding {
  source: string;
  text: string;
}

export interface RevisionBrief {
  stageLabel: string;
  /** The stage's own instruction, from the template. */
  instruction: string;
  findings: RevisionFinding[];
  /** The review stages the findings were read from, for the UI to name. */
  sources: string[];
  /** Per section id: the saved work the section reports, as it stands now (C9). */
  records?: Record<string, string>;
}

/** Rows a review stage asks to be acted on: accepted findings, and claims marked for removal. */
function actionable(stage: StageDefinition, content: string | undefined): RevisionFinding[] {
  const items = parseItems(content) ?? [];
  const schema = itemSchemaFor(stage);
  const tone = new Map((schema.statuses ?? []).map((s) => [s.value, s.tone]));
  const isTriage = tone.has('accepted') && tone.has('rejected');

  return items.flatMap((item) => {
    const status = item.status ?? '';
    // Triage: only what the user accepted. A rejected finding is a decision
    // not to change the text, and applying it anyway would overrule them.
    // Outcome tables (a claim marked "Remove"): the warn outcome is the edit.
    const act = status === 'accepted' || (!isTriage && tone.get(status) === 'warn');
    if (!act) return [];
    const parts = schema.fields
      .map((f) => (item[f.key] ?? '').trim())
      .filter(Boolean);
    const label = !isTriage ? ` [${status}${item.reason ? `: ${item.reason.trim()}` : ''}]` : '';
    return parts.length ? [{ source: stage.label, text: `${parts.join(' — ')}${label}` }] : [];
  });
}

/**
 * The brief for a long-form stage that rewrites the manuscript, or null for the
 * stage that drafts it (the first long-form stage), which has nothing to revise.
 */
export function revisionBrief(
  template: WorkflowTemplate,
  stageId: string,
  bundles: Record<string, StageArtifactBundle>,
  /** With the state, a derived outline's sections carry their current record. */
  state?: WorkflowState
): RevisionBrief | null {
  const index = template.stages.findIndex((s) => s.id === stageId);
  const stage = template.stages[index];
  if (!stage || effectiveRenderer(stage) !== 'long_form') return null;

  let previous = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (effectiveRenderer(template.stages[i]) === 'long_form') {
      previous = i;
      break;
    }
  }
  if (previous < 0) return null;

  const reviews = template.stages
    .slice(previous + 1, index)
    .filter((s) => effectiveRenderer(s) === 'review');

  return {
    stageLabel: stage.label,
    instruction: stage.entry_prompt_hint ?? '',
    findings: reviews.flatMap((s) => actionable(s, bundles[s.id]?.versions.at(-1)?.content)),
    sources: reviews.map((s) => s.label),
    ...(state && template.outline_stage === 'derived' ? { records: sectionRecords(template, state, bundles) } : {}),
  };
}

/** The findings as the notes block a section rewrite is sent. */
export function formatRevisionNotes(findings: RevisionFinding[]): string {
  return findings.map((f) => `- (${f.source}) ${f.text}`).join('\n');
}
