import type { WorkflowTemplate } from '../types';

/**
 * Research workflow — the 13 stages named in the Phase 2 specification.
 *
 * Structurally this is the FR-03 proof. It differs from Book in exactly two
 * ways, both expressed as data rather than code:
 *
 *   1. outline_stage is 'derived' — Research has no separate Outline stage;
 *      the drafting stage builds one from the artifacts already gathered
 *      (question -> intro, literature -> related work, runs -> results, and
 *      so on).
 *   2. It has no branch stage; Book's continuity/expansion fork does not
 *      apply.
 *
 * Everything else is the same shape with different content. Stage 8
 * (reproduction) uses the identical 'review' renderer as Book's fact-checking:
 * both are "a table of items, each with a status and a required reason for the
 * non-clean ones".
 */
export const RESEARCH_V1: WorkflowTemplate = {
  key: 'research',
  version: 1,
  name: 'Research',
  description: 'Question through validated write-up, with the analysis plan fixed before the data.',
  outline_stage: 'derived',
  stages: [
    {
      id: 'question',
      label: 'Research question',
      short_label: 'Question',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'State the question, what would count as an answer, and what would show you are wrong. A question that nothing could falsify is a topic, not a question.',
      exit_criteria: [
        { id: 'q.stated', label: 'Question is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true },
        { id: 'q.answerable', label: 'Says what would count as an answer', check: 'manual' },
        { id: 'q.falsifiable', label: 'Says what would falsify it', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'research_question', cardinality: 'one', primary: true }],
      recommended_modes: [
        { mode: 'clarity', reason: 'Narrows a topic into something answerable' },
        { mode: 'critic', reason: 'Catches a question that cannot fail' },
      ],
      skip_reasons: [],
      transitions: { default_next: 'literature', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'literature',
      label: 'Literature context',
      short_label: 'Literature',
      group: 'planning',
      required: true,
      renderer: 'list',
      entry_guidance:
        'Map the work this sits against. For each entry say how it relates to your question — a list of citations is not a context.',
      exit_criteria: [
        { id: 'lit.three', label: 'At least three works', check: 'auto', rule: { type: 'min_items', n: 3 } },
        { id: 'lit.gap', label: 'A gap is identified', check: 'manual', blocking: true },
      ],
      expected_artifacts: [{ kind: 'literature_map', cardinality: 'many', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Relation to your question matters more than summary' }],
      skip_reasons: ['Exploratory work with no established literature'],
      transitions: { default_next: 'hypothesis', allow_skip: true, allow_return_to: ['question'] },
    },
    {
      id: 'hypothesis',
      label: 'Hypothesis or proposition',
      short_label: 'Hypothesis',
      group: 'planning',
      required: true,
      renderer: 'list',
      entry_guidance:
        'Each hypothesis needs a prediction and an observation that would disconfirm it. Without the second you have a wish list.',
      exit_criteria: [
        { id: 'hyp.one', label: 'At least one hypothesis', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true },
        { id: 'hyp.disconfirm', label: 'Each has a prediction and a disconfirmer', check: 'manual', blocking: true },
      ],
      expected_artifacts: [{ kind: 'hypotheses', cardinality: 'many', primary: true }],
      recommended_modes: [
        { mode: 'architect', reason: 'Turns a hunch into a testable statement' },
        { mode: 'critic', reason: 'Finds the hypothesis that cannot lose' },
      ],
      skip_reasons: ['Purely descriptive study'],
      transitions: { default_next: 'method', allow_skip: true, allow_return_to: ['question', 'literature'] },
    },
    {
      id: 'method',
      label: 'Method',
      short_label: 'Method',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'Procedure, variables, controls, and how you will analyse the result. Fixing the analysis plan now is what stops the data choosing it for you.',
      exit_criteria: [
        { id: 'meth.stated', label: 'Method is described', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
        // Ordering-sensitive on purpose: this is pre-registration, and it only
        // means anything if it happens before the experiment stage opens.
        { id: 'meth.analysisplan', label: 'Analysis plan fixed before running anything', check: 'manual', blocking: true },
      ],
      expected_artifacts: [{ kind: 'method', cardinality: 'one', primary: true }],
      recommended_modes: [
        { mode: 'architect', reason: 'Method is structure under another name' },
        { mode: 'analyst', reason: 'Keeps the analysis plan honest and specific' },
      ],
      skip_reasons: [],
      transitions: { default_next: 'experiment', allow_skip: false, allow_return_to: ['hypothesis'] },
    },
    {
      id: 'experiment',
      label: 'Experiment or investigation',
      short_label: 'Experiment',
      group: 'drafting',
      required: true,
      renderer: 'list',
      entry_guidance:
        'Record each planned run and what actually happened, including deviations. A run that was not done needs a reason, not silence.',
      exit_criteria: [
        { id: 'exp.results', label: 'Every planned run has a result or a reason', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'runs', cardinality: 'many', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Deviations are data, not embarrassments' }],
      skip_reasons: ['Theoretical work with no runs'],
      transitions: { default_next: 'analysis', allow_skip: true, allow_return_to: ['method'] },
    },
    {
      id: 'analysis',
      label: 'Analysis',
      short_label: 'Analysis',
      group: 'evaluation',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Give each hypothesis a verdict, tied to specific evidence rather than an overall impression.',
      exit_criteria: [
        { id: 'ana.verdicts', label: 'Each hypothesis has an evidence-backed verdict', check: 'manual', blocking: true },
      ],
      expected_artifacts: [{ kind: 'analysis', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Holds the verdict to the evidence actually collected' }],
      skip_reasons: [],
      transitions: { default_next: 'alternatives', allow_skip: false, allow_return_to: ['experiment', 'method'] },
    },
    {
      id: 'alternatives',
      label: 'Alternative explanations',
      short_label: 'Alternatives',
      group: 'evaluation',
      required: true,
      renderer: 'list',
      entry_guidance:
        'What else would produce this result? Each alternative is either addressed or explicitly left open — both are acceptable, ignoring them is not.',
      exit_criteria: [
        { id: 'alt.two', label: 'At least two alternatives considered', check: 'auto', rule: { type: 'min_items', n: 2 } },
        { id: 'alt.addressed', label: 'Each addressed or left open', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'alternatives', cardinality: 'many', primary: true }],
      // The structural twin of Book's continuity stage: an adversarial pass.
      recommended_modes: [{ mode: 'cold_critic', reason: 'You are the worst judge of your own preferred explanation' }],
      skip_reasons: ['Alternatives ruled out by design'],
      transitions: { default_next: 'validation', allow_skip: true, allow_return_to: ['analysis', 'experiment'] },
    },
    {
      id: 'validation',
      label: 'Reproduction or validation',
      short_label: 'Validation',
      group: 'evaluation',
      required: false,
      renderer: 'review',
      entry_guidance:
        'Each result gets a status: reproduced, not reproduced, or not attempted with a reason. Not attempted is honest; unexamined is not.',
      exit_criteria: [
        { id: 'val.status', label: 'Every result has a status', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'validation_table', cardinality: 'many', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Reproduction is a measurement, not a formality' }],
      skip_reasons: ['Single-run study', 'Reproduction out of scope'],
      transitions: { default_next: 'mechanism', allow_skip: true, allow_return_to: ['analysis'] },
    },
    {
      id: 'mechanism',
      label: 'Mechanism',
      short_label: 'Mechanism',
      group: 'planning',
      required: false,
      renderer: 'prose',
      entry_guidance: 'Why does this happen? A stated "unknown" is a finding; an unstated one is a gap a reader will find for you.',
      exit_criteria: [
        { id: 'mech.stated', label: 'A causal account, or an explicit unknown', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'mechanism', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'Mechanism is structure behind the result' }],
      skip_reasons: ['Mechanism out of scope', 'Purely descriptive finding'],
      transitions: { default_next: 'generality', allow_skip: true, allow_return_to: ['analysis'] },
    },
    {
      id: 'generality',
      label: 'Generality',
      short_label: 'Generality',
      group: 'planning',
      required: false,
      renderer: 'prose',
      entry_guidance: 'Where does this hold, and where does it stop? Scope conditions are what stop a finding being over-read.',
      exit_criteria: [
        { id: 'gen.scope', label: 'Scope conditions and limits stated', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'scope_conditions', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'critic', reason: 'Overclaiming happens here more than anywhere else' }],
      skip_reasons: ['Generality out of scope'],
      transitions: { default_next: 'drafting', allow_skip: true, allow_return_to: ['analysis'] },
    },
    {
      id: 'drafting',
      label: 'Drafting',
      short_label: 'Drafting',
      group: 'drafting',
      required: true,
      renderer: 'long_form',
      entry_guidance:
        'The outline is derived from the work already done — question to introduction, literature to related work, runs to results. Adjust it before writing.',
      exit_criteria: [
        { id: 'draft.allsections', label: 'Every section is written', check: 'auto', rule: { type: 'all_sections_complete' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'paper', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'The argument order matters more than the prose here' }],
      skip_reasons: [],
      transitions: { default_next: 'revision', allow_skip: false, allow_return_to: ['analysis', 'alternatives'] },
    },
    {
      id: 'revision',
      label: 'Revision',
      short_label: 'Revision',
      group: 'revision',
      required: true,
      renderer: 'long_form',
      entry_guidance: 'Apply what review found. Each accepted change becomes a version you can compare against.',
      exit_criteria: [
        { id: 'rev.applied', label: 'Accepted findings applied', check: 'auto', rule: { type: 'all_findings_triaged' } },
      ],
      expected_artifacts: [{ kind: 'paper', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'A result nobody can follow is a result nobody uses' }],
      skip_reasons: ['Nothing to apply'],
      transitions: { default_next: 'final_review', allow_skip: true, allow_return_to: ['drafting'] },
    },
    {
      id: 'final_review',
      label: 'Final review',
      short_label: 'Final',
      group: 'final_review',
      required: true,
      renderer: 'review',
      entry_guidance:
        'What was completed, what was skipped and why, and what is still open. Export from here, or carry the open questions into the next study.',
      exit_criteria: [
        { id: 'final.accepted', label: 'Write-up accepted', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'final_evaluation', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['revision', 'alternatives'] },
    },
  ],
};
