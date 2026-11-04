/**
 * An approval that only restates "every finding is decided" (2 Nov, Sean).
 *
 * A designed Check stage carries both the automatic "Every finding accepted or
 * rejected" and an approval in the user's words, "I have accepted or rejected
 * each finding". Under "Handle them for me" the approval is routine; whether it
 * holds is what the table's rows already say, so it is read from them rather
 * than asked of a model, which would be asking whether the user did it.
 */
import type { StageDefinition, WorkflowTemplate } from './types';
import { isTriaged, itemSchemaFor, parseItems } from './stage-artifact';
import { isTriageTable } from './triage';

const RESTATES = [
  /\b(accepted|rejected|decided|triaged)\b.*\b(each|every|all)\b.*\bfindings?\b/i,
  /\b(each|every|all)\b.*\bfindings?\b.*\b(accepted|rejected|decided|triaged)\b/i,
];

export function restatesTriage(label: string): boolean {
  return RESTATES.some((r) => r.test(label));
}

/** The number of findings when every row on the table has a decision, else null. */
export function findingsAllDecided(stage: StageDefinition, content: string | null | undefined): number | null {
  if (!stage.exit_criteria.some((c) => c.rule?.type === 'all_findings_triaged')) return null;
  const schema = itemSchemaFor(stage);
  if (!isTriageTable(schema)) return null;
  const items = parseItems(content) ?? [];
  if (!items.length || !items.every((i) => isTriaged(i, schema))) return null;
  return items.length;
}

/**
 * A design pinned before 2 Nov keeps its "I have accepted or rejected each
 * finding" box beside the automatic "Every finding accepted or rejected"
 * (4 Nov, Sean: Go said it had decided the routine findings, then asked him to
 * attest that he had accepted or rejected each one). What PromptMaster can
 * verify is a rule: on a stage that already has the automatic check, a manual
 * box that only restates it is folded into that check, which blocks if either
 * did. New designs are built this way (`custom.ts`); this applies the same to
 * old ones when they are read, without touching the stored template.
 */
export function withRestatedApprovalsAsChecks(template: WorkflowTemplate): WorkflowTemplate {
  let changed = false;
  const stages = template.stages.map((stage) => {
    const auto = stage.exit_criteria.find((c) => c.check === 'auto' && c.rule?.type === 'all_findings_triaged');
    if (!auto) return stage;
    const restated = stage.exit_criteria.filter((c) => c.check === 'manual' && restatesTriage(c.label));
    if (!restated.length) return stage;
    changed = true;
    const blocking = auto.blocking || restated.some((c) => c.blocking);
    return {
      ...stage,
      exit_criteria: stage.exit_criteria.filter((c) => !restated.includes(c)).map((c) => (c === auto ? { ...c, blocking } : c)),
    };
  });
  return changed ? { ...template, stages } : template;
}
