/**
 * Recommendations: what to suggest, why, and how badly it matters.
 *
 * Pure functions over a template, a stage evaluation and a project — no I/O,
 * no model call, no React, the same discipline as `engine.ts`. A recommendation
 * that only appears when a network call succeeds is a recommendation the
 * acceptance criterion cannot be demonstrated against.
 *
 * ## Two sources, and one of them is guaranteed
 *
 * FR-13 asks an active project to display "at least one workflow
 * recommendation AND one contextual or evaluation-driven recommendation where
 * applicable". The second half is conditional — it needs an evaluation, which
 * costs a model call the user chooses to spend. The first half is not, so
 * `deriveWorkflowRecommendations` is written to be **exhaustive over
 * `canAdvance`**: rule 2 fires whenever a blocking criterion is unmet, rule 3
 * whenever nothing blocking is, and `canAdvance` is by definition
 * `unmet.every(c => !c.blocking)`. Every active stage of every template
 * therefore yields at least one row. That is what makes FR-13 demonstrable
 * rather than lucky, and there is a test that loops all 26 stages of BOOK_V1
 * and RESEARCH_V1 in both states to keep it true.
 *
 * ## Which of the eight `kind` values are used
 *
 * `recommendations.kind` is a closed CHECK constraint from M1 with eight
 * values. This milestone maps onto five of them:
 *
 * | situation | kind |
 * |---|---|
 * | evaluation with `drift === 'High'` or `needs_realignment` | `realignment` |
 * | any other evaluation-driven correction | `fix` |
 * | an unmet exit criterion | `workflow` |
 * | `canAdvance` and a `default_next` | `stage_transition` |
 * | an unmet `field_non_empty` criterion | `setup` |
 *
 * **`quick_action`, `coaching` and `restraint` are deliberately unused.** They
 * were not forgotten. `quick_action` is the retired flow-trigger vocabulary
 * (Challenge / Reframe / Drift Alert), which has backend endpoints but no UI
 * anywhere in the workspace; `coaching` and `restraint` belong to the book's
 * pedagogical layer — telling a user they are over-prompting — which nothing
 * in Phase 2 computes. Re-surfacing any of them is a UI job against endpoints
 * that already exist, not a schema change. The CHECK constraint was not
 * narrowed to match this milestone, and it must not be widened to fit a later
 * one either.
 *
 * ## `instruction` non-empty ⇔ applyable
 *
 * A `fix` or `realignment` carries the literal text spliced into the apply
 * prompt. `workflow`, `stage_transition` and `setup` store `''`, because their
 * affordance is somewhere else on the page already: the exit-criteria
 * checklist, the transition bar, and `ProjectSetup` respectively. The panel
 * renders an Apply button iff `instruction.trim() !== ''`, so the rule is one
 * predicate rather than a list of kinds anyone can forget to extend.
 *
 * ## The deferral gap, stated rather than papered over
 *
 * `decisions.decision_type` has no `defer_recommendation`, and
 * `recommendations.status` has no `deferred`. Deferring therefore leaves the
 * recommendation `pending` and inserts a `project_tasks` row (FR-01's
 * "unresolved tasks"), and **the deferral itself is not in the append-only
 * decision trail** — only the task is, and tasks are ordinary mutable user
 * data. That is a real gap. It is documented here instead of being closed by
 * widening a CHECK constraint that is contract evidence for FR-02, which would
 * make a demo tidier and the audit trail weaker.
 */

import type { ScoreValue } from '@/types/project';
import type { StageDefinition, StageEvaluation, WorkflowTemplate } from './types';
import { getStage } from './engine';

// --- the vocabulary ---------------------------------------------------------

/** Every value `recs_kind_chk` allows. Not every value this module produces. */
export type RecommendationKind =
  | 'quick_action'
  | 'fix'
  | 'workflow'
  | 'coaching'
  | 'restraint'
  | 'setup'
  | 'stage_transition'
  | 'realignment';

export type RecommendationSeverity = 'info' | 'minor' | 'major' | 'blocking';
export type RecommendationStatus = 'pending' | 'accepted' | 'dismissed' | 'superseded';

/**
 * FR-14's payload, and the shape of the `rationale` jsonb column.
 *
 * Four slots, because FR-14 names four things: "the triggering issue, relevant
 * stage or objective, expected benefit, and affected scope where applicable".
 * **None of them may be empty.** See `buildRationale`.
 */
export interface RecommendationRationale {
  triggering_issue: string;
  relevant_stage: string;
  expected_benefit: string;
  scope: string;
}

/**
 * The `scope` jsonb column: structured, not prose.
 *
 * `StageRecommendation.scope` is a sentence a model wrote. This is a machine
 * value the apply path can act on, and the model's sentence rides along in
 * `described_as` so nothing is lost.
 *
 * **An anchor is never inferred from that prose.** A model writing "the second
 * paragraph of the introduction" is describing, not addressing; turning that
 * into a `section_id` by guessing would silently rewrite the wrong paragraph,
 * and a wrong scope is worse than a coarse one because the user cannot see it
 * happen. `kind` narrows only when the *user* narrows it.
 */
export interface RecommendationScope {
  kind: 'document' | 'section' | 'selection';
  /** The model's own words, or a deterministic description. Never empty. */
  described_as: string;
  /** Set only by an explicit user choice. */
  section_id?: string;
  /** Character range in the version's content. Set only by a user selection. */
  selection?: { start: number; end: number };
}

/**
 * A recommendation before it is a row.
 *
 * Derived ones are computed each render and only become rows when the user
 * acts (see `RecommendationsPanel`); evaluation-driven ones are written
 * immediately, because they cost a model call and FR-01 requires them to
 * survive a refresh.
 */
export interface ProposedRecommendation {
  /**
   * A stable identity for a *derived* recommendation, stored in the
   * `category` column.
   *
   * Derived rows are recomputed from scratch on every render, so "the user
   * dismissed this one" cannot be remembered by row id — the row may not
   * exist. It is remembered by this key instead, which is a pure function of
   * the stage and the criterion, and so survives a refresh (FR-01).
   */
  category: string;
  kind: RecommendationKind;
  title: string;
  summary: string;
  suggested_change: string;
  /** Non-empty ⇔ applyable. See the module docstring. */
  instruction: string;
  rationale: RecommendationRationale;
  scope: RecommendationScope;
  /** FR-15 conflict axes. Only applyable recommendations carry any. */
  tags: string[];
  severity: RecommendationSeverity;
}

// --- evaluation signals -----------------------------------------------------

/**
 * The scores severity and kind are derived from.
 *
 * A structural type rather than either concrete evaluation shape: the database
 * row spells them `alignment_score`, the API response nests them under
 * `alignment.score`, and neither should dictate the signature of a pure
 * function. `signalsFromEvaluation` adapts the row.
 */
export interface EvaluationSignals {
  alignment: ScoreValue;
  clarity: ScoreValue;
  /** Inverted polarity: Low is good. */
  drift: ScoreValue;
  completeness: string | null;
  needs_realignment: boolean;
  alignment_explanation?: string;
  drift_explanation?: string;
  clarity_explanation?: string;
  completeness_reason?: string | null;
}

interface EvaluationRowish {
  alignment_score: ScoreValue;
  clarity_score: ScoreValue;
  drift_score: ScoreValue;
  completeness_status?: string | null;
  completeness_reason?: string | null;
  needs_realignment?: boolean;
  alignment_explanation?: string;
  drift_explanation?: string;
  clarity_explanation?: string;
}

export function signalsFromEvaluation(row: EvaluationRowish): EvaluationSignals {
  return {
    alignment: row.alignment_score,
    clarity: row.clarity_score,
    drift: row.drift_score,
    completeness: row.completeness_status ?? null,
    // `needs_realignment` is a generated column and the single authority; only
    // re-derive it when reading a shape that has not got one.
    needs_realignment:
      row.needs_realignment ?? (row.alignment_score === 'Low' || row.drift_score === 'High'),
    alignment_explanation: row.alignment_explanation,
    drift_explanation: row.drift_explanation,
    clarity_explanation: row.clarity_explanation,
    completeness_reason: row.completeness_reason ?? null,
  };
}

/**
 * Severity, derived purely from scores.
 *
 * Not from the model's own opinion of how urgent its suggestion is: an
 * evaluator asked to rate its own findings rates them all `major`, and a
 * severity column where everything is major sorts nothing. These four rules
 * are the whole definition.
 */
export function severityFor(s: EvaluationSignals): RecommendationSeverity {
  // Incomplete AND misaligned: the artifact stopped early *and* what is there
  // answers the wrong question. Nothing downstream should be built on it.
  if (s.completeness === 'incomplete' && s.alignment === 'Low') return 'blocking';
  if (s.alignment === 'Low' || s.drift === 'High') return 'major';
  if (
    s.alignment === 'Medium' ||
    s.clarity === 'Medium' ||
    s.drift === 'Medium' ||
    s.clarity === 'Low'
  ) {
    return 'minor';
  }
  return 'info';
}

/**
 * `realignment` when the work has wandered; `fix` otherwise.
 *
 * `needs_realignment` is the authority the evaluation system already defines
 * (`alignment === 'Low' || drift === 'High'`), so this does not re-derive the
 * condition — it reads it, and adds the explicit drift check only because a
 * caller may hand over a shape whose flag was never computed.
 */
export function kindForEvaluation(s: EvaluationSignals): RecommendationKind {
  return s.drift === 'High' || s.needs_realignment ? 'realignment' : 'fix';
}

// --- FR-14: no empty slot ---------------------------------------------------

/** What the model offered, all three fields optional and all three often ''. */
export interface ModelRationaleFields {
  triggering_issue?: string;
  expected_benefit?: string;
  scope?: string;
}

function firstNonBlank(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Why this is being suggested — FR-14, with every slot filled.
 *
 * `StageRecommendation.triggering_issue`, `expected_benefit` and `scope` all
 * default to `''` in the backend schema, and a model that returns JSON in the
 * right shape with the wrong contents returns exactly that. A blank slot
 * persisted into `rationale` jsonb is not a cosmetic problem: it is an FR-14
 * failure sitting in the database, discovered when someone opens the row as
 * evidence rather than when it was written.
 *
 * So the model's text is preferred and the backfill is deterministic — derived
 * from scores that are already there, in the evaluator's own terms. "Drift
 * scored High against the current stage" is a true and useful sentence that
 * costs nothing to produce and cannot be absent.
 */
export function buildRationale(
  model: ModelRationaleFields | null | undefined,
  signals: EvaluationSignals,
  stage: Pick<StageDefinition, 'label'> | undefined,
  objective: string
): RecommendationRationale {
  const stageLabel = stage?.label ?? 'this stage';

  const derivedIssue = (): string => {
    if (signals.drift === 'High') {
      return firstNonBlank(signals.drift_explanation)
        ? `Drift scored High against ${stageLabel}: ${signals.drift_explanation!.trim()}`
        : `Drift scored High against ${stageLabel}.`;
    }
    if (signals.alignment === 'Low') {
      return firstNonBlank(signals.alignment_explanation)
        ? `Alignment scored Low against the objective: ${signals.alignment_explanation!.trim()}`
        : 'Alignment scored Low against the objective.';
    }
    if (signals.completeness === 'incomplete') {
      return firstNonBlank(signals.completeness_reason)
        ? `The artifact is incomplete: ${signals.completeness_reason!.trim()}`
        : 'The artifact stopped before it was complete.';
    }
    if (signals.clarity === 'Low' || signals.clarity === 'Medium') {
      return firstNonBlank(signals.clarity_explanation)
        ? `Clarity scored ${signals.clarity}: ${signals.clarity_explanation!.trim()}`
        : `Clarity scored ${signals.clarity} on ${stageLabel}.`;
    }
    // Nothing scored badly and a correction was offered anyway — say so
    // plainly rather than inventing a defect.
    return `The evaluation of ${stageLabel} suggested this without flagging a specific defect.`;
  };

  const derivedBenefit = (): string => {
    if (signals.drift === 'High') return `Brings the work back to what ${stageLabel} asked for.`;
    if (signals.alignment === 'Low') {
      return firstNonBlank(objective)
        ? `Points the artifact back at the stated objective: ${objective.trim()}`
        : 'Points the artifact back at the stated objective.';
    }
    if (signals.completeness === 'incomplete') return 'Finishes what the artifact left unsaid.';
    if (signals.clarity !== 'High') return `Makes ${stageLabel} easier to read and act on.`;
    return `Raises the quality of ${stageLabel} without changing what it is about.`;
  };

  return {
    triggering_issue: firstNonBlank(model?.triggering_issue) ?? derivedIssue(),
    // Always available: FR-14 asks for "relevant stage OR objective", and the
    // stage is the one this app can never fail to know.
    relevant_stage: stageLabel,
    expected_benefit: firstNonBlank(model?.expected_benefit) ?? derivedBenefit(),
    scope:
      firstNonBlank(model?.scope) ??
      `The whole of ${stageLabel}'s artifact — no narrower scope was identified.`,
  };
}

/** Human-readable affected scope, for the panel and the apply preview (FR-09). */
export function describeScope(scope: RecommendationScope): string {
  switch (scope.kind) {
    case 'selection':
      return scope.selection
        ? `The selected text (characters ${scope.selection.start}–${scope.selection.end})`
        : 'The selected text';
    case 'section':
      return scope.section_id ? `One section (${scope.section_id})` : 'One section';
    default:
      return 'The whole document';
  }
}

/**
 * The scope column for an evaluation-driven recommendation.
 *
 * Always `document`. The model's sentence is preserved verbatim in
 * `described_as` so the user reads what the evaluator actually said, and the
 * machine value stays coarse because nothing here can honestly narrow it.
 */
export function scopeFromModel(prose: string | undefined, stageLabel: string): RecommendationScope {
  return {
    kind: 'document',
    described_as:
      firstNonBlank(prose) ?? `The whole of ${stageLabel}'s artifact, as it currently stands.`,
  };
}

/**
 * FR-15 tags for an applyable recommendation, derived from scores.
 *
 * Deterministic, because conflict detection is (see `combine.ts`). A model
 * asked to tag its own suggestion would tag two contradictory ones the same
 * way and the warning would never fire.
 *
 * **A known limitation, stated because it is easy to miss.** These tags are a
 * function of the *evaluation*, not of the individual recommendation. One
 * evaluate call returns one correction today, so in practice a stage rarely
 * holds two applyable recommendations whose tags differ — and two derived from
 * the same evaluation would carry identical tags and so never conflict. The
 * detection is real, tested, and correct for the data it is given; it will
 * simply fire less often than the surface implies until recommendations carry
 * per-recommendation axes.
 *
 * The alternative — asking the model for the axes — is what this function
 * exists to avoid, and a wrong warning is worse than an absent one. The right
 * fix is a second deterministic source (the user narrowing a scope, or a
 * "shorten"/"expand" quick action carrying its own tag), not a model call.
 */
export function tagsFromSignals(s: EvaluationSignals): string[] {
  const tags: string[] = [];
  if (s.drift === 'High' || s.alignment === 'Low') tags.push('scope:narrow');
  if (s.completeness === 'incomplete') tags.push('length:longer');
  if (s.clarity === 'Low') tags.push('structure:more');
  else if (s.clarity === 'Medium') tags.push('tone:plain');
  return tags;
}

// --- the model's correction, as a proposal ----------------------------------

/** The backend's `StageRecommendation`, structurally. */
export interface ModelCorrection {
  id: string;
  title: string;
  triggering_issue: string;
  expected_benefit: string;
  scope: string;
  instruction: string;
}

/**
 * Turn the evaluator's offered correction into a row-shaped proposal.
 *
 * Written to the database as soon as it exists, unlike the derived ones: it
 * cost a model call, and FR-01 lists recommendations among the things that
 * must survive refresh, logout and a different browser.
 */
export function proposalFromCorrection(
  correction: ModelCorrection,
  signals: EvaluationSignals,
  stage: StageDefinition | undefined,
  objective: string
): ProposedRecommendation {
  const stageLabel = stage?.label ?? 'this stage';
  const kind = kindForEvaluation(signals);
  const instruction = correction.instruction.trim();
  const title = firstNonBlank(correction.title) ?? `Correct ${stageLabel}`;

  return {
    category: `evaluation:${stage?.id ?? 'unknown'}:${correction.id}`,
    kind,
    title,
    summary: firstNonBlank(correction.triggering_issue) ?? title,
    suggested_change: instruction,
    instruction,
    rationale: buildRationale(correction, signals, stage, objective),
    scope: scopeFromModel(correction.scope, stageLabel),
    tags: instruction ? tagsFromSignals(signals) : [],
    severity: severityFor(signals),
  };
}

// --- FR-13: the guaranteed half ---------------------------------------------

export interface DeriveOptions {
  template: WorkflowTemplate;
  stage: StageDefinition;
  /** The pure exit-criteria evaluation from `engine.ts`. */
  evaluation: StageEvaluation;
  /** Category keys the user has dismissed; filtered on reload so they stick. */
  dismissed?: ReadonlySet<string>;
}

/*
 * Deliberately no `objective` parameter.
 *
 * `buildRationale` takes one, because an evaluation-driven correction's
 * backfill can honestly say "points the artifact back at the stated
 * objective: X". None of the three derived rules can: the setup rule fires
 * precisely when a required field is *missing*, and the other two are about
 * criteria and transitions, which the objective says nothing about. A
 * parameter threaded through to be quoted in a branch no template can reach
 * is worse than no parameter.
 */

/** How many derived rows the panel will ever show. FR-13 says "a limited number". */
export const MAX_DERIVED = 2;

/**
 * Workflow recommendations for the stage the user is on.
 *
 * Three rules, in priority order, capped at two:
 *
 * 1. **A setup gap.** An unmet `field_non_empty` criterion — the project has
 *    no objective, or no audience. First because everything downstream is
 *    generated against those fields, so a stage that proceeds without them
 *    produces work that will have to be redone.
 * 2. **An unmet blocking criterion.** The `detail` string is quoted verbatim:
 *    `engine.ts` already produces the honest one ("3 of 5", "2 still
 *    unresolved"), and paraphrasing it here would be a second place for the
 *    same sentence to drift.
 * 3. **Ready to advance.** Nothing blocking is unmet, so the useful suggestion
 *    is to move on — or, on a terminal stage, to finish.
 *
 * Rules 2 and 3 are exhaustive over `canAdvance`, which is what guarantees at
 * least one row on every active stage.
 */
export function deriveWorkflowRecommendations({
  template,
  stage,
  evaluation,
  dismissed,
}: DeriveOptions): ProposedRecommendation[] {
  const out: ProposedRecommendation[] = [];
  const setupCriterionIds = new Set<string>();

  // --- 1. setup gap ---------------------------------------------------------
  for (const criterion of stage.exit_criteria) {
    const rule = criterion.rule;
    if (rule?.type !== 'field_non_empty') continue;
    const result = evaluation.criteria.find((c) => c.id === criterion.id);
    if (!result || result.satisfied) continue;

    setupCriterionIds.add(criterion.id);
    out.push({
      category: `setup:${stage.id}:${rule.field}`,
      kind: 'setup',
      title: `Fill in the ${rule.field.replace(/_/g, ' ')}`,
      summary: `${stage.label} is waiting on it, and every later stage is generated against it.`,
      suggested_change: `Write the ${rule.field.replace(/_/g, ' ')} in Project setup above.`,
      // Empty: the affordance is the ProjectSetup panel already on the page.
      // An Apply button here would be a second, worse way to type into a box.
      instruction: '',
      rationale: {
        triggering_issue: `"${criterion.label}" is not satisfied on ${stage.label}.`,
        relevant_stage: stage.label,
        expected_benefit:
          'Every stage of this project is generated against the setup fields, so filling this in now is what stops later work having to be redone.',
        scope: 'The project setup, not the artifact.',
      },
      scope: { kind: 'document', described_as: "This project's setup fields." },
      tags: [],
      // Blocking or not is a property of the criterion, and it is the one
      // honest input available — a setup gate the template did not mark
      // blocking is genuinely only advice.
      severity: result.blocking ? 'blocking' : 'minor',
    });
    break;
  }

  // --- 2. an unmet blocking criterion --------------------------------------
  if (out.length < MAX_DERIVED && !evaluation.canAdvance) {
    const blocker = evaluation.unmet.find((c) => c.blocking && !setupCriterionIds.has(c.id));
    if (blocker) {
      out.push({
        category: `workflow:${stage.id}:${blocker.id}`,
        kind: 'workflow',
        title: blocker.label,
        // Verbatim, not paraphrased. `engine.ts` already wrote the honest
        // string and there should be exactly one of it.
        summary: blocker.detail
          ? `${blocker.detail} — ${stage.label} is not finished.`
          : `${stage.label} is not finished.`,
        suggested_change: `Complete "${blocker.label}" before moving on.`,
        instruction: '',
        rationale: {
          triggering_issue: blocker.detail
            ? `"${blocker.label}": ${blocker.detail}.`
            : `"${blocker.label}" is not satisfied.`,
          relevant_stage: stage.label,
          expected_benefit:
            'Later stages read this stage\'s conclusion, so finishing it here is cheaper than discovering the gap two stages downstream.',
          scope: `${stage.label}'s artifact.`,
        },
        scope: { kind: 'document', described_as: `${stage.label}'s artifact.` },
        tags: [],
        severity: 'blocking',
      });
    }
  }

  // --- 3. ready to advance, or to finish -----------------------------------
  if (out.length < MAX_DERIVED && evaluation.canAdvance) {
    const next = stage.transitions.default_next;
    if (next) {
      const target = getStage(template, next);
      const targetLabel = target?.label ?? next;
      out.push({
        category: `advance:${stage.id}:${next}`,
        kind: 'stage_transition',
        title: `Move on to ${targetLabel}`,
        summary: `Nothing on ${stage.label} is outstanding.`,
        suggested_change: `Advance to ${targetLabel}.`,
        // Empty: the transition bar below is the affordance, and it is the
        // only place that writes the workflow event.
        instruction: '',
        rationale: {
          triggering_issue: `Every blocking criterion on ${stage.label} is satisfied.`,
          relevant_stage: stage.label,
          expected_benefit: target?.entry_guidance
            ? `${targetLabel}: ${target.entry_guidance.split('. ')[0]}.`
            : `Starts ${targetLabel}.`,
          scope: 'The project, not the artifact.',
        },
        scope: { kind: 'document', described_as: `Moves the project to ${targetLabel}.` },
        tags: [],
        severity: 'info',
      });
    } else {
      out.push({
        category: `finish:${stage.id}`,
        kind: 'stage_transition',
        title: 'Finish',
        summary: `${stage.label} is the last stage, and nothing on it is outstanding.`,
        suggested_change: 'Mark the project finished.',
        instruction: '',
        rationale: {
          triggering_issue: `${stage.label} ends this workflow and its criteria are satisfied.`,
          relevant_stage: stage.label,
          expected_benefit:
            'Closes the workflow. Everything stays readable and restorable afterwards.',
          scope: 'The project, not the artifact.',
        },
        scope: { kind: 'document', described_as: 'Closes the project.' },
        tags: [],
        severity: 'info',
      });
    }
  }

  const filtered = dismissed ? out.filter((r) => !dismissed.has(r.category)) : out;
  return filtered.slice(0, MAX_DERIVED);
}

/** True when a recommendation can be sent to the apply path. */
export function isApplyable(rec: Pick<ProposedRecommendation, 'instruction'>): boolean {
  return rec.instruction.trim() !== '';
}

const SEVERITY_ORDER: Record<RecommendationSeverity, number> = {
  blocking: 0,
  major: 1,
  minor: 2,
  info: 3,
};

/** Worst first. Stable within a severity, so the panel does not shuffle. */
export function bySeverity<T extends { severity: RecommendationSeverity }>(a: T, b: T): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}

export const SEVERITY_LABEL: Record<RecommendationSeverity, string> = {
  blocking: 'Blocking',
  major: 'Major',
  minor: 'Minor',
  info: 'Suggestion',
};
