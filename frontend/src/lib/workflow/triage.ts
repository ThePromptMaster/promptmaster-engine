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

import { isTriaged, parseItems, type StageItem, type StageItemSchema } from './stage-artifact';

export type TriageRisk = 'routine' | 'material';

export const ROUTINE_SEVERITIES = new Set(['minor', 'moderate']);
export const SEVERITY_OPTIONS = ['minor', 'moderate', 'major'] as const;

/** A table Go may triage: findings with Accept / Defer / Reject, never an outcome table. */
export function isTriageTable(schema: StageItemSchema): boolean {
  return Boolean(schema.statuses?.some((s) => s.value === 'accepted')) && schema.fields.some((f) => f.key === 'severity' && f.options);
}

/**
 * Words the user decided that a finding may name: an accepted fact, or a
 * requirement the brief states (4 Nov). Only the words are read; `source`
 * names the brief field a requirement came from, and is absent for a fact.
 */
export interface FactWords {
  statement: string;
  source?: string;
}

const norm = (t: string) => t.toLowerCase().replace(/[“”"'‘’`]/g, '').replace(/[^\p{L}\p{N}$%.,]+/gu, ' ').replace(/[.,](?=\s|$)/g, '').trim();

/** "Output format: Decision memo…" → "Decision memo…": a quote may carry the field's name. */
const FIELD_LABEL = /^\s*(?:the\s+)?(?:brief(?:'s)?\s+)?(?:output\s+format|format|constraints?|requirements?|project\s+context|context|deliverable|brief)\s*[:—–-]\s*/i;
export function withoutFieldLabel(quote: string): string {
  return quote.replace(FIELD_LABEL, '');
}

/**
 * The words a row's quote names, matched in code: the quote and the fact or
 * requirement contain one another once case, quotes, spacing and a leading
 * field name are set aside. A quote that matches nothing current names
 * nothing — a row cannot make itself routine by citing something the user
 * never decided.
 */
export function quotedFact(quote: string | undefined, facts: readonly FactWords[] | undefined): FactWords | null {
  const q = norm(withoutFieldLabel(quote ?? ''));
  if (q.length < 12 || !facts?.length) return null;
  return facts.find((f) => {
    const s = norm(f.statement);
    return s.length >= 12 && (s.includes(q) || q.includes(s));
  }) ?? null;
}

/** The brief fields whose words decide a correction, and how a reason names them. */
const BRIEF_FIELDS = [
  ['constraints', 'Constraints'],
  ['output_format', 'Output format'],
  ['context', 'Your request'],
] as const;

/**
 * What the user decided in the brief itself, as words a finding may quote
 * (4 Nov, Sean's support-software memo: the check's "major" heading row
 * quoted the Output format, matched nothing, and Go stopped for it). The
 * constraints and output format are each one requirement; the project
 * context — the user's own request — is read a line at a time, so a quote
 * must sit inside one thing the user said. The objective is left out: nearly
 * any change can claim to serve it, and a line that only restates it decides
 * nothing.
 */
export function briefWords(brief: { objective?: string | null; constraints?: string | null; output_format?: string | null; context?: string | null }): FactWords[] {
  const objective = norm(brief.objective ?? '');
  const restatesObjective = (line: string) => {
    const l = norm(line);
    return Boolean(objective) && (objective.includes(l) || l.includes(objective));
  };
  const out: FactWords[] = [];
  for (const [key, label] of BRIEF_FIELDS) {
    const text = (brief[key] ?? '').trim();
    if (!text) continue;
    const parts = key === 'context' ? text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"(])/) : [text];
    for (const part of parts) {
      const line = part.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (norm(line).length < 12 || restatesObjective(line)) continue;
      out.push({ statement: line, source: label });
    }
  }
  return out;
}

/**
 * Everything a finding may cite as already decided: the current accepted
 * facts, then the brief's own requirements. Facts come first, so a quote that
 * matches both is credited to the fact.
 */
export function decidedWords(project: {
  facts?: readonly { statement: string; retired_at?: string | null }[] | null;
  objective?: string | null;
  constraints?: string | null;
  output_format?: string | null;
  context?: string | null;
}): FactWords[] {
  const facts = (project.facts ?? []).filter((f) => !f.retired_at).map((f) => ({ statement: f.statement }));
  return [...facts, ...briefWords(project)];
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
/** The reason recorded on a row accepted because the brief already settles it (4 Nov). */
export const BRIEF_REASON = 'Settled by your brief —';

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/**
 * Rows decided in code, with no model call: an undecided finding that only
 * carries out an accepted fact or requirement (its `implements` quote matches
 * one, and no `changes` quote does) is accepted, with the fact named as the
 * reason (1 Nov). The user made that decision when they recorded the fact —
 * or, for a requirement the brief states, when they wrote the brief (4 Nov).
 */
export function recordedDecisions(items: readonly StageItem[], schema: StageItemSchema, facts?: readonly FactWords[]): TriageDecision[] {
  if (!schema.statuses?.some((s) => s.value === 'accepted')) return [];
  return items.flatMap((item) => {
    if (isTriaged(item, schema) || quotedFact(item.changes, facts)) return [];
    const fact = quotedFact(item.implements, facts);
    if (!fact) return [];
    // A brief requirement is named by its field, with the words the row quoted
    // (the user's request can be long; the quote is the part that decides it).
    const reason = fact.source
      ? `${BRIEF_REASON} ${fact.source}: "${clip(withoutFieldLabel(item.implements ?? '').trim() || fact.statement.trim(), 300)}"`
      : `${RECORDED_REASON} "${fact.statement.trim()}"`;
    return [{ id: item.id, status: 'accepted', reason }];
  });
}

/**
 * The reason recorded on a row accepted because the deliverable already
 * carries it out (4 Nov): Go fixed the problem on the final stage, and the
 * review's row about the earlier draft was still listed as undecided in the
 * approval question ("Session 1 timings sum to 105", on a version where they
 * summed to 90).
 */
export const CARRIED_OUT_REASON = 'Already carried out in';

/**
 * A version that only records rows as accepted because the deliverable
 * already carries them out changes nothing a later stage read: each changed
 * row went from undecided to accepted, as Go's decision, with
 * `CARRIED_OUT_REASON`, and nothing else in the table moved. Saving it must not
 * reopen the deliverable it names, or the recheck would revise it again.
 */
export function onlyRecordsCarriedOut(before: string | null | undefined, after: string | null | undefined): boolean {
  const a = parseItems(before);
  const b = parseItems(after);
  if (!a || !b || a.length !== b.length || a.length === 0) return false;
  let recorded = 0;
  for (let i = 0; i < a.length; i += 1) {
    const { status: wasStatus, status_source: wasSource, reason: wasReason, ...restA } = a[i];
    const { status, status_source: source, reason, ...restB } = b[i];
    if (JSON.stringify(restA) !== JSON.stringify(restB)) return false;
    if (wasStatus === status && wasSource === source && wasReason === reason) continue;
    const undecided = !wasStatus || wasSource === 'proposed';
    if (!undecided || status !== 'accepted' || source !== 'model' || !(reason ?? '').startsWith(CARRIED_OUT_REASON)) return false;
    recorded += 1;
  }
  return recorded > 0;
}
