/**
 * The options a reserved approval offers (12 Nov). Pure.
 *
 * A reserved approval was a tick: "Approve and resume" on Go's card, a
 * checkbox on the stage. On two projects the stage laid out Option A and
 * Option B and said "Awaiting the user's decision", and there was nowhere to
 * say which ("Where am I supposed to select A?"). The options are read from
 * the stage's own text (`POST /api/agent/decision-options`), each with the
 * passage that states it; choosing one gives the approval and records the
 * choice as a fact of the project.
 */
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

export interface DecisionOption {
  label: string;
  /** The passage of the stage's text that states it. */
  quote: string;
}

/** What one approval offers, as the page holds it. */
export interface DecisionOffer {
  /** The decision in one sentence; '' when none was given. */
  question: string;
  options: DecisionOption[];
  /** Still being read from the stage's text. */
  loading: boolean;
}

/** One approval whose options are to be read. */
export interface DecisionTarget {
  criterionId: string;
  approval: string;
  stageId: string;
  stageLabel: string;
  content: string;
  /** The stage's head version: options are read once per text. */
  versionId: string;
}

/**
 * Whether an approval is to be given by choosing: its options are on the card,
 * or still being read. While that is so, nothing offers a bare tick for it —
 * not the card's own button, and not the pinned copy of it.
 */
export function givenByChoosing(offer: DecisionOffer | null | undefined): boolean {
  return Boolean(offer && (offer.loading || offer.options.length > 0));
}

export const offerKey = (t: Pick<DecisionTarget, 'criterionId' | 'versionId'>): string => `${t.criterionId}:${t.versionId}`;

/** A decision still waiting for its approval, with the options its stage puts to the user. */
export interface PendingDecision {
  criterionId: string;
  stageId: string;
  options: readonly DecisionOption[];
}

/** An option's own name, where its label leads with one: "Option A: take the carrier…" is "Option A". */
function optionName(label: string): string | null {
  const lead = /^\s*([^:—–]{1,40}?)\s*(?::|—|–|\s-\s)/.exec(label)?.[1]?.trim();
  if (!lead || lead.split(/\s+/).length > 3) return null;
  return lead;
}

/**
 * The waiting decision an answer makes, when the answer names exactly one of
 * its options (12 Nov, production pass). Go asked "Which recovery option do
 * you choose?" as a question of its own, while the approval "I choose the
 * recovery option" waited two stages back with the same two options. The
 * answer "Option A: I approve the $1,400 spending exception" was recorded as
 * an answer, the approval stayed unticked, and Go went back to ask for it:
 * the client's "it asked me again".
 *
 * Narrow on purpose. Every option of the decision must carry a name of its
 * own, the answer must name one of them and no other, and only one waiting
 * decision may be named: anything else is left as an answer.
 */
export function decisionForAnswer(
  answer: string,
  pending: readonly PendingDecision[]
): { criterionId: string; stageId: string; choice: string } | null {
  const said = answer.replace(/\s+/g, ' ').trim();
  if (!said) return null;
  const hits: { criterionId: string; stageId: string; choice: string }[] = [];
  for (const d of pending) {
    if (d.options.length < 2) continue;
    const names = d.options.map((o) => optionName(o.label));
    if (names.some((n) => !n)) continue;
    const keys = names.map((n) => n!.toLowerCase());
    if (new Set(keys).size !== keys.length) continue;
    const named = d.options.filter((_, i) => new RegExp(`(?<![\\p{L}\\p{N}])${names[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(said));
    if (named.length === 1) hits.push({ criterionId: d.criterionId, stageId: d.stageId, choice: named[0].label });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * An approval worded as a decision, not only a sign-off: "I choose Option A or
 * Option B", "I approve this decision on the cap". With no options read from
 * the text, it still gets a place to say what was decided.
 */
export function asksForDecision(label: string): boolean {
  // "ready for my decision", "the decision record" and "this decision package"
  // are sign-offs on other work, not the decision (the last was offered a box
  // on a final sign-off, 12 Nov, production pass).
  return /\b(?:choose|chosen|choice|select|decide|which one|options?)\b|\b(?:this|the|my) decision (?:on|about|to|whether|between|is)\b|\bapprove (?:this|the|my) decision\b(?!\s+(?:package|pack|record|log|memo|brief|document|report|paper|file)\b)/i.test(label);
}

/**
 * The reserved approvals not yet given on the named stages, where the stage
 * holds text to read the options from. A delegable approval is Go's to check
 * and commit, and a table is decided row by row, so neither is one of these.
 */
export function decisionTargets(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined,
  manualChecks: Record<string, boolean> | null | undefined,
  stageIds: readonly (string | null | undefined)[]
): DecisionTarget[] {
  const wanted = new Set(stageIds.filter((s): s is string => Boolean(s)));
  const out: DecisionTarget[] = [];
  for (const stage of template.stages) {
    if (!wanted.has(stage.id) || stage.renderer !== 'prose') continue;
    const head = bundles?.[stage.id]?.versions.at(-1);
    const content = (head?.content ?? '').trim();
    if (!head || !content) continue;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || c.authority === 'delegable' || manualChecks?.[c.id]) continue;
      out.push({ criterionId: c.id, approval: c.label, stageId: stage.id, stageLabel: stage.label, content, versionId: head.id });
    }
  }
  return out;
}

/** The decision as it is recorded and shown: one line, bounded. */
export function decisionText(choice: string): string {
  const text = choice.replace(/\s+/g, ' ').trim();
  return text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text;
}

/** What Go's repair of the stage is told, once the user has decided. */
export function recordDecisionReason(choice: string): string {
  return `the user has decided: "${decisionText(choice)}". Record it as the decision of record wherever this stage says the decision is awaited, pending or still to be made, and carry it through what depends on it here. Change nothing else.`;
}
