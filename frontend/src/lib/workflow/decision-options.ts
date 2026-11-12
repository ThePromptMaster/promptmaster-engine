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

export const offerKey = (t: Pick<DecisionTarget, 'criterionId' | 'versionId'>): string => `${t.criterionId}:${t.versionId}`;

/**
 * An approval worded as a decision, not only a sign-off: "I choose Option A or
 * Option B", "I approve this decision on the cap". With no options read from
 * the text, it still gets a place to say what was decided.
 */
export function asksForDecision(label: string): boolean {
  // "ready for my decision" and "the decision record" are sign-offs on other work, not the decision.
  return /\b(?:choose|chosen|choice|select|decide|which one|options?)\b|\b(?:this|the|my) decision (?:on|about|to|whether|between|is)\b|\bapprove (?:this|the|my) decision\b/i.test(label);
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
