import type { WorkflowTemplate } from '../types';

/**
 * Book workflow — the 13 stages named in the Phase 2 specification.
 *
 * Every stage below is data. The only Book-specific thing in the entire system
 * is this file: no component, prompt builder or route branches on it. That now
 * includes what each stage *asks the model for* — `entry_prompt_hint` is
 * appended to the mode-locked system prompt by the stage generator, so the
 * difference between a stage that produces audience segments and one that
 * produces a claim table lives here rather than in a code path.
 *
 * `version: 2` because those hints changed the definition and v1 is already
 * published. Published templates are immutable: projects pin the version they
 * started on, so a project mid-way through v1 keeps the workflow it began.
 *
 * The exported symbol stays BOOK_V1 — it names *the Book template*, which is
 * one module however many versions it has published. Renaming the export on
 * every content edit would churn every import for no reader's benefit.
 */
export const BOOK_V1: WorkflowTemplate = {
  key: 'book',
  version: 2,
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
      entry_prompt_hint:
        'Produce a statement of what this book is for: the change it should make in a reader, what would count as having succeeded, and what it deliberately does not cover. A few short paragraphs, no headings. A good one is usable as a test — it can be held up against a chapter idea and reject it; one that could justify any book has done nothing.',
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
      entry_prompt_hint:
        'Produce audience segments, not an essay about the audience. Each item names one group in \'who\', states what that group already knows in \'prior_knowledge\', and says what they came to the book for in \'what_they_want\'. A segment that could describe anyone is not a segment: name a group specific enough that you could picture one of them putting the book down, and say what would make them do it.',
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
      entry_prompt_hint:
        'Produce a positioning statement: the books this one sits beside, named as actual titles rather than categories, and the single thing it does that they do not. Put the differentiator in one sentence a reader could later judge false. If the claim cannot fail, it is not positioning.',
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
      entry_prompt_hint:
        'Produce a table of the claims the book intends to make. Each item carries \'claim\' — one assertion, stated flatly and in full; \'source\' — where it can be checked, named as specifically as you can manage, or an honest \'none, author experience\'; and \'confidence\' — how firm it is and what would shake it. Do not invent citations. An unsourced row is useful; a plausible-looking reference that does not exist costs a day at fact-checking.',
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
      entry_prompt_hint:
        'Produce the ordered sections of the book. Each has a title and a short abstract saying what that section does and why it belongs here rather than three chapters later. The order is the argument: someone reading only the abstracts, in sequence, should see the case being built. Cover every need the audience stage identified, and nothing outside the stated scope.',
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
      entry_prompt_hint:
        'Produce the objections worth raising before this outline is frozen. Each row names one problem with the outline as it stands — a gap, an ordering that breaks the argument, two sections doing the same work, or a promise from the objective with nowhere to land. Raise only what would cost a rewrite if it surfaced during drafting. If the outline holds, say so in a few rows rather than manufacturing findings.',
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
      entry_prompt_hint:
        'Write this section\'s prose in full, at the length the outline\'s abstract implies. Stay inside that abstract — material that belongs to another section goes in that section, not here. Write to the audience segments as described: assume what they already know and do not re-explain it, and connect to the sections either side rather than restating them.',
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
      entry_prompt_hint:
        'Produce continuity findings drawn from the draft itself. Each row states the problem in \'finding\', points to the section or passage in \'where\', and rates it in \'severity\'. Look for contradictions, a term used two ways, a point argued twice, and anything the book promised and never delivered. Report what is on the page, not what books like this usually get wrong.',
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
      entry_prompt_hint:
        'Rewrite the section applying the accepted findings and only those. Prose that was not flagged stays as it is — an unrequested improvement buries the change it was mixed in with. Return the whole section as it should now read, not a description of what you changed.',
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
      entry_prompt_hint:
        'Read as someone with no stake in the book succeeding. Each row carries \'finding\' — what is wrong, stated plainly; \'why_it_matters\' — what it costs the reader if it stands; and \'suggested_change\' — what to do instead, specific enough to act on without asking a follow-up question. Take the argument, structure and evidence before style, and do not spend rows on praise.',
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
      entry_prompt_hint:
        'Extract the factual claims the draft actually makes and give each one a row: \'claim\' in the draft\'s own terms, \'source\' naming where it can be checked, and \'status\' — verified, unverifiable, or remove. Every row needs a status, and unverifiable is a legitimate one; a source you are not certain exists is not. Arguments, judgements and opinions are not factual claims — leave them out.',
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
      entry_prompt_hint:
        'Work at the line, not the argument. Cut padding, break up sentences that have collapsed under their own clauses, remove the second sentence that says what the first already said, and vary rhythm that has gone flat. Meaning, structure and voice stay exactly as they are. Return the full edited text; a passage needing nothing comes back unchanged.',
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
      entry_prompt_hint:
        'Produce the closing account of the manuscript. Rows should cover what it now delivers against the original objective, which stages were skipped and what that leaves unchecked, and what remains open. State unfinished work plainly — this is the last place it gets recorded before the book leaves.',
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
