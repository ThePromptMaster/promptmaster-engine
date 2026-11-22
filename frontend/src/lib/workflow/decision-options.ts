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

/** A requirement of the user's that the stage's own text shows an option fails (L-274). */
export interface OptionFails {
  /** The requirement, as the user gave it. */
  requirement: string;
  /** The passage of the stage's text that shows the option fails it. */
  quote: string;
}

export interface DecisionOption {
  label: string;
  /** The passage of the stage's text that states it. */
  quote: string;
  /**
   * Set when the stage's text shows the option failing one of the user's own
   * requirements (22 Nov, Sean: Option A at $52,000 against a hard $50,000 cap
   * was a button like Option B, and pressing it was recorded). Such an option is
   * explained, never offered: to choose it, the requirement is changed first.
   */
  fails?: OptionFails | null;
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

/** A quoted passage without its closing full stop, for a sentence that ends with its own (“…requirement.”. read twice). */
export function unstopped(text: string): string {
  return text.trim().replace(/[.。]+$/, '');
}

/** The options that may be chosen: those the stage's text does not show failing a requirement. */
export function eligibleOptions(options: readonly DecisionOption[]): DecisionOption[] {
  return options.filter((o) => !o.fails);
}

/** A decision still waiting for its approval, with the options its stage puts to the user. */
export interface PendingDecision {
  criterionId: string;
  stageId: string;
  options: readonly DecisionOption[];
  /**
   * The approval is given already, with an option chosen (L-275). An answer then
   * changes the decision only when it says it chooses: "what does Option B cost?"
   * names an option and decides nothing.
   */
  given?: boolean;
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
): { criterionId: string; stageId: string; choice: string; fails: OptionFails | null } | null {
  const said = answer.replace(/\s+/g, ' ').trim();
  if (!said) return null;
  const hits: { criterionId: string; stageId: string; choice: string; fails: OptionFails | null }[] = [];
  for (const d of pending) {
    if (d.given && !choosesAnOption(said)) continue;
    const named = optionsNamed(said, d.options);
    if (named?.length === 1) hits.push({ criterionId: d.criterionId, stageId: d.stageId, choice: named[0].label, fails: named[0].fails ?? null });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The options a text names by their own names ("Option A"), or null when the
 * options do not each carry a distinct name of their own.
 */
function optionsNamed(said: string, options: readonly DecisionOption[]): DecisionOption[] | null {
  if (options.length < 2) return null;
  const names = options.map((o) => optionName(o.label));
  if (names.some((n) => !n)) return null;
  const keys = names.map((n) => n!.toLowerCase());
  if (new Set(keys).size !== keys.length) return null;
  return options.filter((_, i) => new RegExp(`(?<![\\p{L}\\p{N}])${names[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(said));
}

/** Words that choose: "Approve Option B", "go with B", "I pick A". */
export function choosesAnOption(text: string): boolean {
  return /\b(?:approve[sd]?|approving|choose|chose|chosen|go(?:ing)? with|pick(?:ed)?|select(?:ed)?|decide[sd]? on|opt(?:ed)? for|prefer)\b/i.test(text);
}

/**
 * The option a decision names that the stage's text shows failing one of the
 * user's requirements, if it names exactly one option and that one fails
 * (L-274): typed or pressed, it is not recorded, and the user is told why.
 */
export function failingChoice(choice: string, options: readonly DecisionOption[] | null | undefined): DecisionOption | null {
  const said = choice.replace(/\s+/g, ' ').trim();
  if (!said || !options?.length) return null;
  const exact = options.find((o) => o.label.replace(/\s+/g, ' ').trim() === said);
  if (exact) return exact.fails ? exact : null;
  const named = optionsNamed(said, options);
  return named?.length === 1 && named[0].fails ? named[0] : null;
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

/** One approval an answer may decide, and whether it is given already. */
export interface DecisionCandidate extends DecisionTarget {
  given: boolean;
}

/**
 * The reserved approvals an answer to Go's own question may be the decision on
 * (L-275): worded as a choice, or decided by choosing before, ticked or not.
 * 22 Nov, Sean: "Approve Option B at $49,000 all-in", typed to Go's question
 * while the approval still stood for Option A, was kept as a note only, so his
 * later press on A stood beside it and the final memo followed B.
 */
export function decisionCandidates(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined,
  manualChecks: Record<string, boolean> | null | undefined,
  facts: readonly { source_ref?: Record<string, unknown> | null }[] | null | undefined
): DecisionCandidate[] {
  const decided = new Set(
    (facts ?? [])
      .map((f) => f.source_ref as { criterion_id?: unknown; choice?: unknown } | null | undefined)
      .filter((r) => typeof r?.criterion_id === 'string' && typeof r?.choice === 'string')
      .map((r) => r!.criterion_id as string)
  );
  const out: DecisionCandidate[] = [];
  for (const stage of template.stages) {
    if (stage.renderer !== 'prose') continue;
    const head = bundles?.[stage.id]?.versions.at(-1);
    const content = (head?.content ?? '').trim();
    if (!head || !content) continue;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || c.authority === 'delegable') continue;
      if (!decided.has(c.id) && !asksForDecision(c.label)) continue;
      out.push({ criterionId: c.id, approval: c.label, stageId: stage.id, stageLabel: stage.label, content, versionId: head.id, given: Boolean(manualChecks?.[c.id]) });
    }
  }
  return out;
}

/** Thrown when a choice names an option its stage shows failing a requirement (L-274): said, never recorded. */
export class ChoiceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChoiceRefused';
  }
}

/** The decision as it is recorded and shown: one line, bounded. */
export function decisionText(choice: string): string {
  const text = choice.replace(/\s+/g, ' ').trim();
  return text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text;
}

/** What Go's repair of the stage is told, once the user has decided. */
export function recordDecisionReason(choice: string): string {
  return `the user has decided: "${decisionText(choice)}". Record it as the decision of record wherever this stage says the decision is awaited, pending or still to be made, and carry it through what depends on it here. A recommendation, option or line that the decision rules out is removed or rewritten to match it (15 Nov: "Recommendation: Option B" stayed after the user chose A). Change nothing else.`;
}
