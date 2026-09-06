import type { WorkflowTemplate } from '../types';

/**
 * The legacy 5-phase flow, expressed as data.
 *
 * This exists for two reasons. It is the strongest evidence that the engine is
 * genuinely declarative — the flow the whole app was built around becomes a
 * template rather than a special case. And it is the retirement path for
 * /session: once this renders correctly, that route becomes a redirect.
 */
export const SINGLE_OUTPUT_V1: WorkflowTemplate = {
  key: 'single_output',
  version: 1,
  name: 'Single output',
  description: 'One prompt, evaluated and refined.',
  outline_stage: 'none',
  stages: [
    {
      id: 'input',
      label: 'Objective and setup',
      short_label: 'Input',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'Say what you want and who it is for. The clearer the objective, the less work the later stages have to do.',
      exit_criteria: [
        {
          id: 'input.objective',
          label: 'Objective is stated',
          check: 'auto',
          rule: { type: 'field_non_empty', field: 'objective' },
          blocking: true,
        },
      ],
      expected_artifacts: [{ kind: 'objective_statement', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Sharpens a vague objective before it costs you a pass' }],
      skip_reasons: [],
      transitions: { default_next: 'review', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'review',
      label: 'Review the prompt',
      short_label: 'Review',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Check the assembled prompt before spending a call on it. Edit anything that reads wrong.',
      exit_criteria: [
        { id: 'review.checked', label: 'Prompt looks right', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'prompt', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: ['The prompt is already right'],
      transitions: { default_next: 'output', allow_skip: true, allow_return_to: ['input'] },
    },
    {
      id: 'output',
      label: 'Output and evaluation',
      short_label: 'Output',
      group: 'evaluation',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Read the output against the objective, not in isolation. The scores are a prompt to look, not a verdict.',
      exit_criteria: [
        { id: 'output.exists', label: 'An output exists', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'output', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'critic', reason: 'Stress-tests an output that looks fine at a glance' }],
      skip_reasons: [],
      transitions: { default_next: 'realign', allow_skip: false, allow_return_to: ['input', 'review'] },
    },
    {
      id: 'realign',
      label: 'Realignment',
      short_label: 'Realign',
      group: 'revision',
      required: false,
      renderer: 'prose',
      entry_guidance:
        'Offered every time, worth taking only when the output drifted. Correct the instruction rather than the text where you can.',
      exit_criteria: [
        { id: 'realign.applied', label: 'Correction applied', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'output', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Drift usually starts in the instruction, not the output' }],
      skip_reasons: ['Alignment and drift are already good', 'The output is close enough', 'I will fix it by hand'],
      transitions: { default_next: 'summary', allow_skip: true, allow_return_to: ['output'] },
    },
    {
      id: 'summary',
      label: 'Final review',
      short_label: 'Summary',
      group: 'final_review',
      required: true,
      renderer: 'review',
      entry_guidance: 'Confirm this is what you needed, then export it or carry the lessons into the next piece of work.',
      exit_criteria: [
        { id: 'summary.accepted', label: 'Output accepted', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'output', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['output', 'realign'] },
    },
  ],
};
