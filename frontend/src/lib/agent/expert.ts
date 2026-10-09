/**
 * The expert review package (Q3a). Pure, apart from the types.
 *
 * Sean, 9 Oct: "For physics, 'ask a physicist' should identify a specific
 * technical issue, the checks available or already attempted, and which next
 * actions depend on resolving it … PromptMaster should prepare a concise
 * package containing the question, assumptions, derivation or computation,
 * evidence, unresolved issue, and specific judgment requested."
 *
 * When Go's question is one for an expert, the backend prepares the package
 * from the saved record (`/api/agent/expert-package`), and the stop shows it
 * with Copy and Download, kept on the step's record.
 */

import { itemSchemaFor, stageContentForChat } from '@/lib/workflow/stage-artifact';
import { isDone, type WorkflowState, type WorkflowTemplate } from '@/lib/workflow/types';
import type { StageArtifactBundle } from '@/lib/workflow/digest';

export interface ExpertPackage {
  question: string;
  assumptions: { text: string; status: 'accepted' | 'assumed' }[];
  working: { quote: string; source: string; label: 'executed' | 'derived' | 'proposed' }[];
  evidence: string[];
  checks: string[];
  unresolved: string;
  judgment_requested: string;
  depends_on_it: string[];
}

const EXPERT = /\b(?:expert|specialist|physicist|mathematician|statistician|domain (?:knowledge|judg(?:e)?ment)|peer[- ]review|(?:technical|scientific|professional) judg(?:e)?ment|which (?:formulation|treatment|convention|discreti[sz]ation|regulari[sz]ation|interpretation) is (?:correct|right|appropriate))\b/i;

/** The question asks for a specialist's judgment rather than a choice the user can make. */
export function needsExpert(question: string): boolean {
  return EXPERT.test(question);
}

/** The saved record a package may quote: each stage's latest saved text, rows rendered as lines. */
export function recordDocuments(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>
): { label: string; text: string; executed: boolean }[] {
  return template.stages.flatMap((stage) => {
    const head = bundles[stage.id]?.versions.at(-1);
    const status = state.stages[stage.id]?.status;
    if (!head?.content?.trim() || !(isDone(status) || status === 'in_progress' || status === 'stale')) return [];
    const text = stageContentForChat(itemSchemaFor(stage), head.content);
    return text.trim() ? [{ label: stage.label, text: text.slice(0, 200_000), executed: /Ran in the sandbox/.test(text) }] : [];
  }).slice(0, 30);
}

const LABEL: Record<ExpertPackage['working'][number]['label'], string> = {
  executed: 'executed — code ran',
  derived: 'derived — written out, not executed',
  proposed: 'proposed — not done',
};

/** The package as a document the user can copy or send. */
export function packageMarkdown(p: ExpertPackage, projectTitle: string): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none on record)');
  return [
    `# Expert review: ${projectTitle}`,
    '',
    '## Question',
    p.question,
    '',
    '## Assumptions',
    p.assumptions.length ? p.assumptions.map((a) => `- ${a.text} (${a.status === 'accepted' ? 'accepted in the project' : 'assumed, not established'})`).join('\n') : '- (none stated)',
    '',
    '## Working on record',
    p.working.length ? p.working.map((w) => `> ${w.quote}\n\n— ${w.source}, ${LABEL[w.label]}`).join('\n\n') : '(no working could be quoted from the record)',
    '',
    '## Evidence',
    list(p.evidence),
    '',
    '## Checks made or available',
    list(p.checks),
    '',
    '## What is unresolved',
    p.unresolved,
    '',
    '## The judgment requested',
    p.judgment_requested,
    '',
    '## What depends on it',
    list(p.depends_on_it),
  ].join('\n');
}
