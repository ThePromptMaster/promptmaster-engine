import type { WorkflowTemplate } from '../types';

/**
 * Quick answer — what you asked for, straight away (Sean, 26 Oct: "the
 * starting experience could be more like Claude. You type what you want and
 * get an answer or draft up front, without having to go through all the
 * stages first").
 *
 * One stage, drafted the moment the project opens. Follow-ups go through the
 * side chat; Refine and Finish are there as on any prose stage. When the work
 * turns out to need more, "Take this into the full process" re-pins the same
 * project to a full workflow (`workflow_switched`) and the answer becomes the
 * first version of its deliverable — nothing is made again.
 */
export const QUICK_V1: WorkflowTemplate = {
  key: 'quick',
  version: 1,
  name: 'Quick answer',
  description: 'An answer or a draft straight away, with no stages to go through first.',
  outline_stage: 'none',
  stages: [
    {
      id: 'answer',
      label: 'Answer',
      short_label: 'Answer',
      group: 'drafting',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'Here is what you asked for. Ask a follow-up in the chat, refine it, or take it into the full PromptMaster process for stages, checks and approvals.',
      entry_prompt_hint:
        'Answer the objective directly: produce the finished thing it asks for — the answer, the draft, the piece of writing — ready to use as it stands. Do not write a plan, a prompt, an outline of the work or a description of what you would do. Where something needed is unknown, make a sensible assumption and say what you assumed in one short line at the end.',
      exit_criteria: [
        {
          id: 'answer.objective',
          label: 'Objective is stated',
          check: 'auto',
          rule: { type: 'field_non_empty', field: 'objective' },
          blocking: true,
        },
        { id: 'answer.exists', label: 'An output exists', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'output', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: [] },
    },
  ],
};
