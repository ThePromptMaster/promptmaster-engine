/**
 * Which findings Go may decide on its own, and how a decision is applied (B3).
 * Pure.
 *
 * Sean, 28 Sep, items 10 and 11: "if I am in Autonomous mode, I think
 * PromptMaster should probably resolve routine/low-risk findings itself and
 * stop me only for decisions that meaningfully change the work." Risk is read
 * from the row's own severity, which is an enum now (minor / moderate /
 * major); anything else — an older free-text severity, a table with no
 * severity at all — is material, because unknown is not routine.
 */

import { isTriaged, type StageItem, type StageItemSchema } from './stage-artifact';

export type TriageRisk = 'routine' | 'material';

export const ROUTINE_SEVERITIES = new Set(['minor', 'moderate']);
export const SEVERITY_OPTIONS = ['minor', 'moderate', 'major'] as const;

/** A table Go may triage: findings with Accept / Defer / Reject, never an outcome table. */
export function isTriageTable(schema: StageItemSchema): boolean {
  return Boolean(schema.statuses?.some((s) => s.value === 'accepted')) && schema.fields.some((f) => f.key === 'severity' && f.options);
}

export function findingRisk(item: StageItem, schema: StageItemSchema): TriageRisk {
  const field = schema.fields.find((f) => f.key === 'severity' && f.options);
  if (!field) return 'material';
  const value = (item.severity ?? '').trim().toLowerCase();
  if (!field.options!.includes(value)) return 'material';
  return ROUTINE_SEVERITIES.has(value) ? 'routine' : 'material';
}

export function splitUntriaged(items: readonly StageItem[], schema: StageItemSchema): { routine: StageItem[]; material: StageItem[] } {
  const routine: StageItem[] = [];
  const material: StageItem[] = [];
  for (const item of items) {
    if (isTriaged(item, schema)) continue;
    (findingRisk(item, schema) === 'routine' ? routine : material).push(item);
  }
  return { routine, material };
}

export interface TriageDecision {
  id: string;
  status: string;
  reason?: string;
}

/**
 * Apply decisions to the rows they name. A decision for an unknown row, a
 * status the table does not offer, or one that demands a reason without
 * giving one is dropped — the row stays undecided for the user.
 */
export function applyTriage(
  items: readonly StageItem[],
  decisions: readonly TriageDecision[],
  schema: StageItemSchema
): { items: StageItem[]; applied: string[] } {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const applied: string[] = [];
  const next = items.map((item) => {
    const d = byId.get(item.id);
    if (!d || isTriaged(item, schema)) return item;
    const option = schema.statuses?.find((s) => s.value === d.status);
    if (!option) return item;
    const reason = (d.reason ?? '').trim();
    if (option.requiresReason && !reason) return item;
    applied.push(item.id);
    return { ...item, status: option.value, ...(reason ? { reason } : {}) };
  });
  return { items: next, applied };
}
