/**
 * An approval that only restates "every finding is decided" (2 Nov, Sean).
 *
 * A designed Check stage carries both the automatic "Every finding accepted or
 * rejected" and an approval in the user's words, "I have accepted or rejected
 * each finding". Under "Handle them for me" the approval is routine; whether it
 * holds is what the table's rows already say, so it is read from them rather
 * than asked of a model, which would be asking whether the user did it.
 */
import type { StageDefinition } from './types';
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
