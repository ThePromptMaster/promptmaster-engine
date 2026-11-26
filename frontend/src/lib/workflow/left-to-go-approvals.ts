/**
 * Reserved approvals the user left to Go (19 Nov). Pure.
 *
 * Sean, Equipment Replacement: his brief kept back only "warranty verification
 * and actual purchase authorization", yet the designed workflow made "I choose the
 * vendor to recommend" an approval only he could give. Go stopped for it as "yours
 * alone"; he answered "You choose, and state the deciding factor clearly", and it
 * stopped again. "It should be able to recommend a vendor, explain its reasoning,
 * and complete the review while leaving purchase authorization pending."
 *
 * An `approval_left_to_go` event makes one reserved approval Go's to give under
 * "handle them for me": written by the page when the brief's own words hand it
 * over (the sentence checked word for word by `/api/agent/approval-delegated`), or
 * when the user's answer leaves that choice to Go. The newest event for an approval
 * decides; the user's "This is mine to decide" writes one marked undone. The
 * database accepts Go's commit only while such an event stands
 * (`workflow_events_agent_authorized`), and never for the last stage's sign-off or
 * a stage's commitments sign-off.
 */

import { isDelegatedAnswer } from './answers';
import type { ExitCriterion, StageDefinition, WorkflowEvent, WorkflowTemplate } from './types';

export const LEFT_TO_GO = 'approval_left_to_go' as const;

export interface LeftToGo {
  quote: string;
  source: 'brief' | 'answer';
}

type EventLike = Pick<WorkflowEvent, 'type' | 'payload'> & { seq?: number };

/** Authorising a spend, a purchase, a payment, a signature or something going out: never Go's. */
const AUTHORISES = /\b(?:authori[sz]\w*|purchas\w*|spend\w*|pay\w*|sign\w*|send\w*|sent|releas\w*|publish\w*|contract\w*|hire|hiring|order\w*)\b/i;

/** Whether an approval sends, signs, spends or authorises something outside the project (26 Nov). */
export function isOutgoing(label: string): boolean {
  return AUTHORISES.test(label);
}

/** Whether this approval could ever be left to Go: reserved, not the last stage's, not a commitments sign-off. */
export function mayBeLeftToGo(template: Pick<WorkflowTemplate, 'stages'>, stage: Pick<StageDefinition, 'id'>, c: ExitCriterion): boolean {
  const last = template.stages.at(-1)?.id;
  return (
    c.check === 'manual' && c.authority !== 'delegable' && !c.id.endsWith('.decision') &&
    stage.id !== last && !AUTHORISES.test(c.label)
  );
}

/** The approvals left to Go now: the newest event for each, unless it was taken back. */
export function approvalsLeftToGo(events: readonly EventLike[] | null | undefined): Map<string, LeftToGo> {
  const newest = new Map<string, { undone: boolean; quote: string; source: 'brief' | 'answer' }>();
  for (const e of events ?? []) {
    if (e.type !== LEFT_TO_GO) continue;
    const p = (e.payload ?? {}) as { criterion_id?: unknown; quote?: unknown; source?: unknown; undone?: unknown };
    const id = typeof p.criterion_id === 'string' ? p.criterion_id : '';
    if (!id) continue;
    newest.set(id, { undone: p.undone === true, quote: typeof p.quote === 'string' ? p.quote : '', source: p.source === 'answer' ? 'answer' : 'brief' });
  }
  const out = new Map<string, LeftToGo>();
  for (const [id, g] of newest) if (!g.undone && g.quote.trim()) out.set(id, { quote: g.quote, source: g.source });
  return out;
}

/** Every approval the user has said anything about, either way: the brief is not read for these again. */
export function approvalsSpokenFor(events: readonly EventLike[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of events ?? []) {
    const id = e.type === LEFT_TO_GO ? (e.payload as { criterion_id?: unknown } | null)?.criterion_id : null;
    if (typeof id === 'string' && id) out.add(id);
  }
  return out;
}

/** A key that changes only when an approval is left to Go or taken back: what the template depends on. */
export function leftToGoSignature(events: readonly EventLike[] | null | undefined): string {
  return [...approvalsLeftToGo(events)].map(([id, g]) => `${id}:${g.source}`).join('|');
}

/** The template every reader is given: an approval left to Go is delegable, and says why. */
export function withApprovalsLeftToGo(template: WorkflowTemplate, events: readonly EventLike[] | null | undefined): WorkflowTemplate {
  const left = approvalsLeftToGo(events);
  if (!left.size) return template;
  let changed = false;
  const stages = template.stages.map((stage) => {
    if (!stage.exit_criteria.some((c) => left.has(c.id) && mayBeLeftToGo(template, stage, c))) return stage;
    changed = true;
    return {
      ...stage,
      exit_criteria: stage.exit_criteria.map((c) =>
        left.has(c.id) && mayBeLeftToGo(template, stage, c) ? { ...c, authority: 'delegable' as const, leftToGo: left.get(c.id)! } : c
      ),
    };
  });
  return changed ? { ...template, stages } : template;
}

/** The reserved approvals the brief has not yet been read for. */
export function approvalsToRead(template: WorkflowTemplate, events: readonly EventLike[] | null | undefined, manualChecks: Record<string, boolean>) {
  const spoken = approvalsSpokenFor(events);
  return template.stages.flatMap((stage) =>
    stage.exit_criteria
      .filter((c) => mayBeLeftToGo(template, stage, c) && !spoken.has(c.id) && !manualChecks[c.id])
      .map((c) => ({ id: c.id, label: c.label, stage_label: stage.label }))
  );
}

const STOP = new Set(['which', 'should', 'would', 'their', 'there', 'about', 'this', 'that', 'these', 'those', 'with', 'from', 'into', 'your', 'have', 'name', 'choose', 'decide', 'approve', 'accept']);

function stems(text: string): Set<string> {
  return new Set(
    text.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:ations?|ing|ed|es|s)$/, '').slice(0, 7)) ?? []
  );
}

/**
 * The reserved approval on this stage a question is about, when the user leaves
 * that question to Go: "Which vendor should the recommendation name?" is about
 * "I choose the vendor to recommend" (two shared words). Null when none is plainly it.
 */
export function approvalTheQuestionIsAbout(
  template: WorkflowTemplate,
  stage: StageDefinition,
  question: string,
  manualChecks: Record<string, boolean>
): ExitCriterion | null {
  const asked = stems(question);
  const found = stage.exit_criteria.filter((c) => {
    if (!mayBeLeftToGo(template, stage, c) || manualChecks[c.id]) return false;
    const shared = [...stems(c.label)].filter((w) => asked.has(w)).length;
    return shared >= 2;
  });
  return found.length === 1 ? found[0] : null;
}

/**
 * A decision typed where an approval asks for one ("Or say what you decide instead")
 * that leaves it to Go: "You choose". Only under "handle them for me", and only for an
 * approval that may be left to Go; otherwise it is recorded as the user's decision.
 */
export function leavesChoiceToGo(
  text: string,
  routine: string | null | undefined,
  template: Pick<WorkflowTemplate, 'stages'>,
  stage: Pick<StageDefinition, 'id'>,
  criterion: ExitCriterion
): boolean {
  return routine === 'handle' && isDelegatedAnswer(text) && mayBeLeftToGo(template, stage, criterion);
}
