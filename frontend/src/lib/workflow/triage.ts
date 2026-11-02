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

/** An accepted fact a finding may name: only its words are read. */
export interface FactWords {
  statement: string;
}

const norm = (t: string) => t.toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/[^\p{L}\p{N}$%.,]+/gu, ' ').replace(/[.,](?=\s|$)/g, '').trim();

/**
 * The accepted fact a row's quote names, matched in code: the quote and the
 * fact contain one another once case, quotes and spacing are set aside. A
 * quote that matches no current fact names nothing — a row cannot make
 * itself routine by citing something the user never decided.
 */
export function quotedFact(quote: string | undefined, facts: readonly FactWords[] | undefined): FactWords | null {
  const q = norm(quote ?? '');
  if (q.length < 12 || !facts?.length) return null;
  return facts.find((f) => {
    const s = norm(f.statement);
    return s.length >= 12 && (s.includes(q) || q.includes(s));
  }) ?? null;
}

/**
 * Whether a finding is Go's to decide under "handle them for me" (B3).
 *
 * Severity is not the only rule (1 Nov, Sean: "A major correction that
 * restores an explicit user requirement may already be authorized. A small
 * alteration to a hard constraint may not be."). A row whose suggested change
 * would alter an accepted fact or requirement is the user's whatever its
 * severity; one that only carries out an accepted fact is routine whatever its
 * severity — the decision was made when the user recorded it. Both are read
 * from the row's quote of the fact (`changes`, `implements`), matched against
 * the current facts in code.
 */
export function findingRisk(item: StageItem, schema: StageItemSchema, facts?: readonly FactWords[]): TriageRisk {
  if (quotedFact(item.changes, facts)) return 'material';
  if (quotedFact(item.implements, facts)) return 'routine';
  const field = schema.fields.find((f) => f.key === 'severity' && f.options);
  if (!field) return 'material';
  const value = (item.severity ?? '').trim().toLowerCase();
  if (!field.options!.includes(value)) return 'material';
  return ROUTINE_SEVERITIES.has(value) ? 'routine' : 'material';
}

export function splitUntriaged(
  items: readonly StageItem[],
  schema: StageItemSchema,
  facts?: readonly FactWords[]
): { routine: StageItem[]; material: StageItem[] } {
  const routine: StageItem[] = [];
  const material: StageItem[] = [];
  for (const item of items) {
    if (isTriaged(item, schema)) continue;
    (findingRisk(item, schema, facts) === 'routine' ? routine : material).push(item);
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
    // Not Go's to claim: a status that says something was actually carried out, or one no longer offered.
    if (!option || option.requiresExecution || option.legacy) return item;
    const reason = (d.reason ?? '').trim();
    if (option.requiresReason && !reason) return item;
    applied.push(item.id);
    // Go's decision, recorded as such: a status with no source reads as the
    // user's, and Go's routine triage is not (G1, 6 Oct).
    return { ...item, status: option.value, status_source: 'model', ...(reason ? { reason } : {}) };
  });
  return { items: next, applied };
}

/** The reason recorded on a row accepted because it carries out the user's own decision. */
export const RECORDED_REASON = 'Carries out what you already decided:';

/**
 * Rows decided in code, with no model call: an undecided finding that only
 * carries out an accepted fact or requirement (its `implements` quote matches
 * one, and no `changes` quote does) is accepted, with the fact named as the
 * reason (1 Nov). The user made that decision when they recorded the fact.
 */
export function recordedDecisions(items: readonly StageItem[], schema: StageItemSchema, facts?: readonly FactWords[]): TriageDecision[] {
  if (!schema.statuses?.some((s) => s.value === 'accepted')) return [];
  return items.flatMap((item) => {
    if (isTriaged(item, schema) || quotedFact(item.changes, facts)) return [];
    const fact = quotedFact(item.implements, facts);
    return fact ? [{ id: item.id, status: 'accepted', reason: `${RECORDED_REASON} "${fact.statement.trim()}"` }] : [];
  });
}
