import type { WorkflowTemplate } from '../types';

/**
 * Book workflow — the 13 stages named in the Phase 2 specification.
 *
 * Every stage below is data. The only Book-specific thing in the entire system
 * is this file: no component, prompt builder or route branches on it.
 */
export const BOOK_V1: WorkflowTemplate = {
  key: 'book',
  version: 1,
  name: 'Book',
  description: 'Objective through final review, with an approved outline driving the draft.',
  outline_stage: 'explicit',
  stages: [
    {
      id: 'objective',
      label: 'Objective and purpose',
      short_label: 'Objective',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'State what the book is for and what it is not. Saying what is out of scope now saves an argument with yourself at chapter nine.',
      exit_criteria: [
        { id: 'obj.stated', label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true },
        { id: 'obj.success', label: 'Says what success looks like', check: 'manual' },
        { id: 'obj.scope', label: 'Says what is out of scope', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'objective_statement', cardinality: 'one', primary: true }],
      recommended_modes: [
        { mode: 'clarity', reason: 'Turns a broad ambition into something you can test against' },
        { mode: 'architect', reason: 'Gives the purpose a shape the later stages can build on' },
      ],
      skip_reasons: [],
      transitions: { default_next: 'audience', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'audience',
      label: 'Audience',
      short_label: 'Audience',
      group: 'planning',
      required: true,
      renderer: 'list',
      entry_guidance:
        'Describe who this is for: what they already know, what they want, and where they will be reading. Every later stage is judged against this.',
      exit_criteria: [
        { id: 'aud.one', label: 'At least one audience segment', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true },
        { id: 'aud.knowledge', label: 'Each segment has prior knowledge and motivation', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'audience_profile', cardinality: 'many', primary: true }],
      recommended_modes: [
        { mode: 'analyst', reason: 'Keeps segments evidence-based rather than aspirational' },
        { mode: 'clarity', reason: 'Forces plain description over marketing language' },
      ],
      skip_reasons: ['I am writing for myself', 'The audience is already well defined elsewhere'],
      transitions: { default_next: 'positioning', allow_skip: true, allow_return_to: ['objective'] },
    },
    {
      id: 'positioning',
      label: 'Positioning',
      short_label: 'Positioning',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance:
        'Name the books this sits beside and say what yours does that they do not. A promise you cannot fail is not a promise.',
      exit_criteria: [
        { id: 'pos.comparables', label: 'At least two comparables named', check: 'auto', rule: { type: 'min_items', n: 2 } },
        { id: 'pos.differentiator', label: 'One-sentence differentiator', check: 'manual', blocking: true },
        { id: 'pos.falsifiable', label: 'The promise could be judged false', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'positioning_statement', cardinality: 'one', primary: true }],
      // Critic is the default here on purpose: positioning claims exist to be
      // stress-tested, and an encouraging reader is no use at this stage.
      recommended_modes: [
        { mode: 'critic', reason: 'Positioning claims exist to be stress-tested' },
        { mode: 'architect', reason: 'Frames the claim against the surrounding market' },
      ],
      skip_reasons: ['Not a commercial book', 'Positioning already agreed'],
      transitions: { default_next: 'research', allow_skip: true, allow_return_to: ['objective', 'audience'] },
    },
    {
      id: 'research',
      label: 'Research',
      short_label: 'Research',
      group: 'planning',
      required: false,
      renderer: 'list',
      entry_guidance:
        'Gather the claims you intend to make and where each one comes from. Unsupported claims found now are cheap; found at fact-checking they are not.',
      exit_criteria: [
        { id: 'res.notes', label: 'Research notes captured', check: 'auto', rule: { type: 'min_items', n: 1 } },
        { id: 'res.openquestions', label: 'Open questions noted or deferred', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'research_notes', cardinality: 'many', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Separates what you know from what you assume' }],
      skip_reasons: ['Writing from existing expertise', 'Research already done elsewhere'],
      transitions: { default_next: 'outline', allow_skip: true, allow_return_to: ['objective', 'audience', 'positioning'] },
    },
    {
      id: 'outline',
      label: 'Outline',
      short_label: 'Outline',
      group: 'outlining',
      required: true,
      renderer: 'outline',
      entry_guidance:
        'Shape the argument before writing it. Reorder freely here — moving a chapter now costs nothing, later it costs a rewrite.',
      exit_criteria: [
        { id: 'out.sections', label: 'Outline has sections', check: 'auto', rule: { type: 'min_items', n: 2 }, blocking: true },
        { id: 'out.covers', label: 'Every audience need maps to a section', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'outline', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'Structure is the whole job at this stage' }],
      skip_reasons: [],
      transitions: { default_next: 'outline_approval', allow_skip: false, allow_return_to: ['objective', 'audience', 'research'] },
    },
    {
      id: 'outline_approval',
      label: 'Outline approval',
      short_label: 'Approval',
      group: 'outlining',
      required: true,
      renderer: 'review',
      entry_guidance:
        'Approving pins a specific outline version. Drafting writes against that version, and you will be told if you later change it.',
      exit_criteria: [
        { id: 'appr.approved', label: 'An outline version is approved', check: 'auto', rule: { type: 'outline_approved' }, blocking: true },
      ],
      expected_artifacts: [],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: 'drafting', allow_skip: false, allow_return_to: ['outline'] },
    },
    {
      id: 'drafting',
      label: 'Drafting',
      short_label: 'Drafting',
      group: 'drafting',
      required: true,
      renderer: 'long_form',
      entry_guidance:
        'Sections are written one at a time against the approved outline. You can pause, edit a section by hand, or regenerate any single one.',
      exit_criteria: [
        { id: 'draft.allsections', label: 'Every section is written', check: 'auto', rule: { type: 'all_sections_complete' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'manuscript', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: 'continuity', allow_skip: false, allow_return_to: ['outline'] },
    },
    {
      id: 'continuity',
      label: 'Continuity review or controlled expansion',
      short_label: 'Continuity',
      group: 'expansion',
      required: false,
      renderer: 'review',
      entry_guidance:
        'Either check the draft holds together, or deepen the sections that are thin. Expansion diagnoses first and rewrites only what you select.',
      exit_criteria: [
        { id: 'cont.triaged', label: 'Every finding resolved or dismissed', check: 'auto', rule: { type: 'all_findings_triaged' } },
      ],
      expected_artifacts: [{ kind: 'continuity_findings', cardinality: 'many', primary: true }],
      recommended_modes: [
        { mode: 'cold_critic', reason: 'Contradictions survive a sympathetic reader' },
        { mode: 'architect', reason: 'Better suited when you are deepening rather than checking' },
      ],
      skip_reasons: ['The draft is short enough to hold in my head', 'Doing this at revision instead'],
      // The only stage in either template where the user genuinely picks a path.
      transitions: {
        default_next: 'revision',
        allow_skip: true,
        allow_return_to: ['drafting'],
        branch_options: [
          { id: 'continuity_review', label: 'Check continuity', renderer: 'review', group: 'evaluation' },
          { id: 'controlled_expansion', label: 'Expand thin sections', renderer: 'long_form', group: 'expansion' },
        ],
      },
    },
    {
      id: 'revision',
      label: 'Revision',
      short_label: 'Revision',
      group: 'revision',
      required: true,
      renderer: 'long_form',
      entry_guidance: 'Apply what the previous stage found. Each accepted finding becomes a new version you can compare against.',
      exit_criteria: [
        { id: 'rev.applied', label: 'Accepted findings applied', check: 'auto', rule: { type: 'all_findings_triaged' } },
      ],
      expected_artifacts: [{ kind: 'manuscript', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Revision is mostly about being understood' }],
      skip_reasons: ['Nothing to apply'],
      transitions: { default_next: 'critique', allow_skip: true, allow_return_to: ['drafting', 'continuity'] },
    },
    {
      id: 'critique',
      label: 'Critique',
      short_label: 'Critique',
      group: 'evaluation',
      required: true,
      renderer: 'review',
      entry_guidance:
        'A deliberately unsympathetic read. Triage every finding — accepting, deferring or rejecting with a reason is the point, not agreeing.',
      exit_criteria: [
        { id: 'crit.triaged', label: 'Every finding triaged with a reason', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'critique_report', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'cold_critic', reason: 'Praise here costs you a rewrite later' }],
      skip_reasons: ['Already critiqued externally'],
      transitions: { default_next: 'fact_check', allow_skip: true, allow_return_to: ['revision'] },
    },
    {
      id: 'fact_check',
      label: 'Fact-checking and citation review',
      short_label: 'Fact-check',
      group: 'evaluation',
      required: true,
      renderer: 'review',
      entry_guidance:
        'Every claim gets a status: verified, unverifiable, or removed. Unverifiable is an acceptable answer; unexamined is not.',
      exit_criteria: [
        { id: 'fc.status', label: 'Every claim has a status', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'claim_table', cardinality: 'many', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Checking a claim is not the same as believing it' }],
      skip_reasons: ['No factual claims to check', 'Fact-checked externally'],
      transitions: { default_next: 'editing', allow_skip: true, allow_return_to: ['revision', 'critique'] },
    },
    {
      id: 'editing',
      label: 'Editing',
      short_label: 'Editing',
      group: 'revision',
      required: true,
      renderer: 'long_form',
      entry_guidance: 'Line-level work: rhythm, repetition, and the sentences you have read so often you stopped seeing them.',
      exit_criteria: [
        { id: 'edit.done', label: 'Editing pass complete', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'manuscript', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'The last stage where being understood still beats being clever' }],
      skip_reasons: ['A human editor is handling this'],
      transitions: { default_next: 'final_review', allow_skip: true, allow_return_to: ['revision'] },
    },
    {
      id: 'final_review',
      label: 'Final review',
      short_label: 'Final',
      group: 'final_review',
      required: true,
      renderer: 'review',
      entry_guidance:
        'What was completed, what was skipped and why, and what is still open. Export from here, or carry the unresolved items into the next project.',
      exit_criteria: [
        { id: 'final.accepted', label: 'Manuscript accepted', check: 'manual' },
      ],
      expected_artifacts: [{ kind: 'final_evaluation', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['editing', 'critique', 'fact_check'] },
    },
  ],
};
