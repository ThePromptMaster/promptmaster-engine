/**
 * Proposed statuses for rows of a check table already drafted (3 Oct,
 * Research run). Pure. The model call is `propose.ts`.
 */

import { isProposed, isTriaged, type ReviewStatusOption, type StageItem, type StageItemSchema } from './stage-artifact';

export const PROPOSE_LABEL = 'Propose statuses';

/** The statuses a proposal may carry: what the model may set or propose, never a legacy value. */
export function proposalStatuses(schema: StageItemSchema): ReviewStatusOption[] {
  return (schema.statuses ?? []).filter((s) => (s.modelMayPropose || s.modelMaySet) && !s.legacy);
}

/** Rows with no decision and no proposal yet, on a table that takes proposals. */
export function proposeTargets(items: readonly StageItem[], schema: StageItemSchema): StageItem[] {
  if (!(schema.statuses ?? []).some((s) => s.modelMayPropose)) return [];
  return items.filter((i) => !isTriaged(i, schema) && !isProposed(i));
}

export interface ProposalDecision { id: string; status: string; reason?: string }

/**
 * Put the proposals on the rows they name. A proposal for a row that is not
 * a target, with a status the table does not let the model propose, or with
 * no reason, is dropped — the row stays as it was.
 */
export function applyProposals(
  items: readonly StageItem[],
  decisions: readonly ProposalDecision[],
  schema: StageItemSchema
): { items: StageItem[]; applied: string[] } {
  const targets = new Set(proposeTargets(items, schema).map((i) => i.id));
  const allowed = new Set(proposalStatuses(schema).map((s) => s.value));
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const applied: string[] = [];
  const next = items.map((item) => {
    const d = byId.get(item.id);
    const reason = (d?.reason ?? '').trim();
    if (!d || !targets.has(item.id) || !allowed.has(d.status) || !reason) return item;
    applied.push(item.id);
    return { ...item, status: d.status, reason, status_source: 'proposed' };
  });
  return { items: next, applied };
}

/** What the button says once it has run. */
export function proposeSummary(applied: number, asked: number): string {
  if (!applied) return 'PromptMaster could not tell a status from any row\'s text. Set them yourself.';
  const left = asked - applied;
  return `PromptMaster proposed a status for ${applied} row${applied === 1 ? '' : 's'}, each with its reason.` +
    (left > 0 ? ` ${left} ${left === 1 ? 'row does' : 'rows do'} not say enough to tell.` : '') +
    ' Nothing is saved until you confirm or save.';
}
