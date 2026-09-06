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
 * Everything else is the same shape with different content. The reproduction
 * stage uses the identical 'review' renderer as Book's fact-checking: both are
 * "a table of items, each with a status and a required reason for the non-clean
 * ones".
 *
 * `version: 2` because v1 shipped with no `entry_prompt_hint` on any stage. The
 * hint is what the stage generator appends to the mode-locked system prompt, so
 * a hintless stage generates a generic essay about its own topic — a Research
 * project could walk thirteen stages and produce nothing worth keeping. The
 * hints are the discipline of the method written down: a hypothesis states what
 * would falsify it, the analysis plan is fixed before anything runs, an
 * alternative explanation is stated in the form its own advocate would
 * recognise. Published templates are immutable, so this is a new version rather
 * than an edit: a study already running on v1 keeps the workflow it began.
 *
 * v2 also moves `experiment` and `alternatives` from the 'list' renderer to
 * 'review'. Both carry a blocking `every_item_has_status` criterion, and the
 * list renderer draws no status control — so on v1 those two gates could not be
 * satisfied by any sequence of user actions. Review is the renderer whose whole
 * job is "a row, a status, and a reason for the non-clean ones", which is
 * exactly what "every planned run has a result or a reason" asks for.
 *
 * The exported symbol stays RESEARCH_V1 — it names *the Research template*,
 * which is one module however many versions it has published.
 */
export const RESEARCH_V1: WorkflowTemplate = {
  key: 'research',
  version: 2,
  name: 'Research',
  description: 'Question through validated write-up, with the analysis plan fixed before the data.',
  outline_stage: 'derived',
  /**
   * The outline Research never stops to write.
   *
   * Book has an Outline stage and an Outline-approval stage; Research has
   * neither, and until this spec existed that meant a project could plan itself
   * across twelve stages and then find nothing to draft — an empty outline, no
   * approved version, and a disabled button.
   *
   * The mapping is declared rather than generated. Which stage feeds which
   * section of a paper is a convention of the form, and a convention is exactly
   * the kind of thing that should be written down once and read, not asked of a
   * model at a cost of one round-trip and a different answer each time.
   *
   * `required` is set from the source stages' own `allow_skip`: introduction,
   * method, discussion and conclusion rest on stages that cannot be skipped, so
   * they always appear. Every other section is dropped when the stages behind
   * it produced nothing — a theoretical study skips the experiment stage and
   * gets a paper with no Results heading, rather than an empty one.
   */
  derived_outline: {
    stage_id: 'drafting',
    sections: [
      {
        id: 'introduction',
        title: 'Introduction',
        from_stages: ['question', 'hypothesis'],
        guidance:
          'State the question, why it is open, and what would count as an answer. Set out the propositions being tested and what each predicts, so a reader knows before the method what result would settle this against you.',
        required: true,
      },
      {
        id: 'related_work',
        title: 'Related work',
        from_stages: ['literature'],
        guidance:
          'Place the study against the work it follows: what each prior result established, and what it does to this question. Close on the gap — a gap in what is known, not in what has happened to be tried.',
        required: false,
      },
      {
        id: 'method',
        title: 'Method',
        from_stages: ['method'],
        guidance:
          'Give the procedure, the variables and how they are measured, the controls, and the analysis plan as it was fixed before the data. Written so someone else could run it without asking a follow-up question.',
        required: true,
      },
      {
        id: 'results',
        title: 'Results',
        from_stages: ['experiment'],
        guidance:
          'Report what was observed, run by run, including deviations from the plan and runs that were not done. Report; do not yet interpret. A run that disappears between the method and the results is the commonest way a study stops being reproducible.',
        required: false,
      },
      {
        id: 'reproduction',
        title: 'Reproduction and validation',
        from_stages: ['validation'],
        guidance:
          'Say which results were re-run or independently checked, by what means, and how closely they matched. Not attempted is an honest answer when the reason is given; it must not be allowed to read as held.',
        required: false,
      },
      {
        id: 'discussion',
        title: 'Discussion',
        from_stages: ['analysis'],
        guidance:
          'Take each hypothesis in turn and give its verdict against the evidence that decides it, applying the analysis plan as written. Verdicts that went against the expected answer belong here in the same voice as the ones that did not.',
        required: true,
      },
      {
        id: 'threats',
        title: 'Threats to validity',
        from_stages: ['alternatives'],
        guidance:
          'Set out the rival explanations in the form their own advocates would recognise, what in the data is consistent with each, and what rules it out or would be needed to. An alternative left open, with a reason, belongs here too.',
        required: false,
      },
      {
        id: 'interpretation',
        title: 'Interpretation and scope',
        from_stages: ['mechanism', 'generality'],
        guidance:
          'Say why the result comes out this way, or say plainly that the mechanism is unknown and what would establish it. Then give the scope: where the finding holds, where it should be expected to fail, and which of those boundaries are evidenced rather than guessed.',
        required: false,
      },
      {
        id: 'conclusion',
        title: 'Conclusion',
        from_stages: ['analysis', 'generality'],
        guidance:
          'Answer the question as it was originally posed, claiming no more than the scope conditions allow, and name what is still open. A conclusion that reads as though nothing went wrong in a study with open alternatives is not a conclusion, it is a cover.',
        required: true,
      },
    ],
  },
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
      entry_prompt_hint:
        'Produce the research question stated as a question, then what would count as an answer to it, then what result would count against the answer you expect. A few short paragraphs, no headings. Some possible state of the world has to be able to settle this against you: if you cannot say what finding would disappoint you, what you have written is a topic, and a topic runs for years without ever closing.',
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
      entry_prompt_hint:
        'Produce the works this study sits against, one per item, not a summary essay. \'work\' names it specifically enough to be found again — authors, title and year, or the named result if that is how the field refers to it; \'finding\' states what it actually established, not what it was about; \'relation\' says what it does to your question: supports it, contradicts it, answers a neighbouring question, or supplies the method you intend to borrow. Across the set the gap should be visible, and it has to be a gap in knowledge — "nobody has run exactly this combination" is a description of novelty, not a gap. Say what is not known and why it matters that it is not. Do not invent citations: a work you are unsure exists costs more than one fewer row.',
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
      entry_prompt_hint:
        'Produce falsifiable propositions, not a discussion of what might be going on. \'statement\' is the proposition in one flat sentence; \'prediction\' is what you should observe if it holds, specific enough that someone else could go and look — direction, and a magnitude or threshold wherever you can give one; \'disconfirming_observation\' is the result that would make you abandon it. The third field is the test of the other two: if it cannot be filled in without hedging, the hypothesis cannot be wrong, and a hypothesis that cannot be wrong is not a hypothesis, it is the question restated in a confident voice.',
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
      entry_prompt_hint:
        'Produce the method as a pre-registration: what will be done and in what order; each variable and how it is measured; the controls and what they rule out; the sample or scale and why it is enough; and the analysis plan — which comparison decides which hypothesis, on which measure, against which threshold — committed here, before any data exists. Settle the awkward cases now rather than leaving them for the results to settle: the stopping rule, what happens to missing or excluded observations, and what will be done if the measure does not behave. Write it so someone else could run it without asking a follow-up question. An analysis chosen after the results are in is not a method, it is a description of the results; if something genuinely has to stay open, say so and say what will close it, rather than leaving a silent gap for the data to fill.',
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
      // 'review', not 'list': the blocking criterion below is
      // every_item_has_status, and only the review renderer draws a status.
      renderer: 'review',
      entry_guidance:
        'Record each planned run and what actually happened, including deviations. A run that was not done needs a reason, not silence.',
      entry_prompt_hint:
        'Produce one row per planned run, taken from the method\'s procedure rather than invented here. \'run\' names what was to be done and under what conditions; \'observed\' records what actually happened, with the numbers where there are numbers; \'deviation\' records anything that differed from the plan, however small. Every row needs a status, and a run that was not done needs a reason. Do not write a result you do not have — mark the row not run and say why. A run that quietly disappears between the method and the results is the commonest way a study stops being reproducible, and it is invisible to every later stage.',
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
      entry_prompt_hint:
        'Take each hypothesis in turn and give it a verdict — supported, not supported, or inconclusive — naming the particular runs or measurements that decide it and what they showed. Apply the analysis plan as it was written; where you depart from it, say where and why in the same sentence rather than in a footnote. Inconclusive is a legitimate verdict and often the honest one. A verdict resting on the overall impression of the results is not a verdict, it is a preference wearing the vocabulary of one, and this is precisely the stage the analysis plan was written to bind.',
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
      // 'review' for the same reason as the experiment stage: alt.addressed is
      // an every_item_has_status gate, and a list has nowhere to put a status.
      renderer: 'review',
      entry_guidance:
        'What else would produce this result? Each alternative is either addressed or explicitly left open — both are acceptable, ignoring them is not.',
      entry_prompt_hint:
        'Produce the explanations other than yours that would produce this same result. \'explanation\' states the rival account in its strongest form — the version someone who believed it would recognise; \'why_plausible\' points at what in your own data is consistent with it; \'how_addressed\' says what rules it out, or what evidence would be needed to. Take the dull candidates first: confounds, selection effects, measurement artefacts, and the possibility that the effect is the procedure rather than the phenomenon. A strawman is worse than an empty stage — it spends the reader\'s trust and leaves the real objection standing for a reviewer to find. Give every row a status; left open, with a reason, is an acceptable answer.',
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
      entry_prompt_hint:
        'Produce one row per result that matters, named in the terms the analysis used rather than restated in new words. \'result\' is the finding; \'attempt\' is what was done to reproduce or validate it — a rerun, an independent sample, a different instrument, someone else\'s data; \'notes\' records what came back, including how closely it matched. Every row needs a status. Not attempted is honest when the reason is given; reproduced is not a status you may award to a result nobody re-ran. A row that lets "we did not check" read as "it held" is the exact failure this stage exists to prevent.',
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
      entry_prompt_hint:
        'Produce a causal account of why the result comes out the way it does: the proposed mechanism, what in the evidence supports it, and what it predicts somewhere else that could be checked. Where the mechanism is unknown, say so outright and say what would be needed to establish it — a named unknown is a finding, and an honest one. A restatement of the result in causal-sounding language is not a mechanism: if striking the word "because" leaves the sentence saying only what the analysis already said, nothing has been explained.',
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
      entry_prompt_hint:
        'Produce the scope conditions: where the finding holds, where it should be expected to fail, and which features of the setting it depends on — population, scale, instrument, time period, the particular configuration tested. State each boundary as something a reader could cross to test it. "Further work is needed to establish generality" says nothing at all; name the conditions under which you would expect the result to break, and mark which of those you have evidence for and which are a guess.',
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
      entry_prompt_hint:
        'Write this section of the write-up in full, at the length its place in the paper implies. The section derives from a stage that is already done — question into the introduction, literature into related work, method into method, runs and analysis into results — so draw on that stage and do not re-derive material belonging to a different one. Report what the analysis actually found, including the verdicts that went against the hypothesis; the results are written from the record, not from the argument you would prefer them to support. Claim no more than the scope conditions allow.',
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
      entry_prompt_hint:
        'Rewrite the section applying the accepted findings and only those. Text nobody flagged stays exactly as it is — an unrequested improvement mixed in buries the change it travelled with. Where a finding weakens a claim, weaken the claim itself rather than wrapping a qualifier around the original wording and leaving it standing. Return the whole section as it should now read, not an account of what you changed.',
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
      entry_prompt_hint:
        'Produce the closing account of the study. Rows should cover what the write-up now claims against the question as it was originally posed, which stages were skipped and what that leaves unverified, which alternative explanations were left open, and which results were never reproduced. \'item\' states the open point; \'where\' says where it stands. Give every row a status and state the unfinished work plainly — this is the last place an unexamined result is recorded before the work leaves, and a clean summary of a study with three open alternatives is not a summary, it is a cover.',
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
