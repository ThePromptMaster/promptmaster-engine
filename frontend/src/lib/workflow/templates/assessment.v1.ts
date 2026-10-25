import type { WorkflowTemplate } from '../types';

/**
 * Assessment — criteria set once, then many items judged against them
 * (client, 25 Oct).
 *
 * The client's case is executive search: copy a LinkedIn profile, paste it,
 * get a colour-coded verdict on whether to screen the candidate — a few
 * profiles at a time, again and again. They did not want the product to become
 * "about" that, and it is not: nothing below names candidates. The same three
 * stages screen suppliers, grant applications, proposals or anything else
 * whose criteria can be written down, on a traffic light, a 1–5, pass/fail,
 * A–F or the user's own words.
 *
 * Criteria are approved before anything is judged, so every verdict on the
 * table answers to the same written standard. Assess stays open for as many
 * batches as there are; the Shortlist summarises the table for sharing and
 * never re-judges it.
 */
export const ASSESSMENT_V1: WorkflowTemplate = {
  key: 'assessment',
  version: 1,
  name: 'Assessment',
  description: 'Set the criteria once, then paste items in batches and get a verdict on each, on the scale you choose.',
  outline_stage: 'none',
  nouns: { deliverable: 'assessment', unit: 'item' },
  stages: [
    {
      id: 'criteria',
      label: 'Criteria',
      short_label: 'Criteria',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Say what you are assessing and what a good one looks like. The criteria are drafted for you to approve; every item is judged against them.',
      entry_prompt_hint:
        'Write the criteria every item will be judged against, from the objective and what the user has said: the must-haves (an item missing one cannot get the best verdict), the strong positives, the deal-breakers, and what would be nice but does not decide anything. Make each criterion something the text of a single item could show or fail to show. Then say, for this work, what each level of a verdict scale should mean (best, close, not a fit). Never a criterion about age, gender, ethnicity, religion, disability, family status or any other protected characteristic, nor a stand-in for one. A list of generic qualities ("strong communicator") with no way to tell from the text is not criteria.',
      exit_criteria: [
        { id: 'criteria.objective', label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true },
        { id: 'criteria.written', label: 'The criteria are written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
        { id: 'criteria.approved', label: 'I approve these criteria for judging every item', check: 'manual', authority: 'reserved', blocking: true },
      ],
      expected_artifacts: [{ kind: 'assessment_criteria', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Turns what you want into criteria a text can show' }],
      skip_reasons: [],
      transitions: { default_next: 'assess', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'assess',
      label: 'Assess',
      short_label: 'Assess',
      group: 'evaluation',
      required: true,
      renderer: 'assess',
      entry_guidance: 'Paste one or more items at a time. Each is judged against the criteria on your scale, and every batch adds to the table.',
      entry_prompt_hint:
        'Judge each item strictly against the approved criteria. Name the must-haves it meets and misses; where the text is silent on one, say so rather than assume.',
      exit_criteria: [
        { id: 'assess.some', label: 'At least one item is assessed', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'assessments', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'critic', reason: 'Holds every item to the same criteria' }],
      skip_reasons: [],
      transitions: { default_next: 'shortlist', allow_skip: false, allow_return_to: ['criteria'] },
      assess: { scale: 'traffic' },
    },
    {
      id: 'shortlist',
      label: 'Shortlist',
      short_label: 'Shortlist',
      group: 'final_review',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Where the assessed items stand, written to share. Go back to Assess to add more at any time.',
      entry_prompt_hint:
        'Summarise the assessment table for someone deciding: how many items were assessed and how many sit at each verdict; the items at the best verdict, one line each on why; the close calls worth a second look, with the one question that would settle each; and any pattern across them (a must-have most items miss). Quote each verdict exactly as the table has it and never re-judge an item; where the user changed a verdict, the user\'s stands.',
      exit_criteria: [
        { id: 'shortlist.written', label: 'The shortlist is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
        { id: 'shortlist.approved', label: 'I approve this shortlist to share', check: 'manual', authority: 'reserved', blocking: true },
      ],
      expected_artifacts: [{ kind: 'assessment_shortlist', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Makes the result quick to read and share' }],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['assess', 'criteria'] },
    },
  ],
};
