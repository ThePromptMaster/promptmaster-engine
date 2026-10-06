import type { WorkflowTemplate } from '../types';

/**
 * Exploration — an idea taken as far as it goes (3 Oct call).
 *
 * The client: "if I'm doing a physics thing, I'm trying to do a theory of
 * everything, this is going to go on forever, which is fine… you come up with
 * an idea and take it as far as you can… but it would still stop you and say
 * 'this is not right'". Rounds of Explore → Test → Findings → Next question;
 * the last stage of a round offers the next one (`loop_to`), which the user
 * starts, so every round is a check-in. Write-up ends it whenever the user
 * chooses.
 *
 * Every hint says what a lazy answer looks like, as Research's do, and none of
 * them ends a round by deferring to an expert: a real limit (safety, a
 * measurement nobody has made) is named as a limit, and the work goes on
 * around it.
 */
export const EXPLORATION_V1: WorkflowTemplate = {
  key: 'exploration',
  // v2 (2026-10-06): each approval says who may satisfy it — a routine one
  // Go may commit under the project's "Routine decisions: handle them for me",
  // a reserved one only the user (Sean, 5 Oct). Criterion ids are unchanged.
  version: 2,
  name: 'Exploration',
  description: 'Take an idea as far as it goes, round after round, testing it as you go.',
  outline_stage: 'none',
  nouns: { deliverable: 'exploration', unit: 'round' },
  inquiry: true,
  stages: [
    {
      id: 'idea',
      label: 'The idea',
      short_label: 'Idea',
      group: 'planning',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Say the idea as a question you could make progress on, and what progress would look like.',
      entry_prompt_hint:
        'State the idea as a precise question, then: what is already established that it builds on, what would count as progress in one round, and what would show it is wrong. A vague restatement of the idea, or a promise to "explore" it, is not a question.',
      exit_criteria: [
        { id: 'idea.objective', label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true },
        { id: 'idea.written', label: 'The question is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'exploration_question', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Turns a big idea into a question a round can move' }],
      skip_reasons: [],
      transitions: { default_next: 'explore', allow_skip: false, allow_return_to: [] },
    },
    {
      id: 'explore',
      label: 'Explore',
      short_label: 'Explore',
      group: 'drafting',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Reason the question through. On a later round, start from where the last one ended.',
      entry_prompt_hint:
        'Reason the current question through as far as it goes: derive, follow consequences, try the simplest case and the extreme ones. Mark each step as established (with what establishes it), a reasoned consequence, or speculation. On a later round, pursue the next question the last round ended on, not the original idea again. Stopping early with "consult an expert" is not an answer: where a real limit is reached — a measurement nobody has made, a safety boundary — name it as a limit and continue with what can still be reasoned.',
      exit_criteria: [
        { id: 'explore.written', label: 'The reasoning is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'exploration_reasoning', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'Builds the argument step by step' }],
      skip_reasons: [],
      transitions: { default_next: 'test', allow_skip: false, allow_return_to: ['idea'] },
    },
    {
      id: 'test',
      label: 'Test it',
      short_label: 'Test',
      group: 'evaluation',
      required: false,
      renderer: 'review',
      entry_guidance: 'Put the round’s claims to a test. You decide which hold up.',
      entry_prompt_hint:
        'Take the claims this round depends on and propose, for each, the sharpest test available without new data: a thought experiment, a limiting case, a known result it must agree with, an internal contradiction to look for. Say what outcome would show it wrong. A test that nothing could fail is not a test.',
      exit_criteria: [
        { id: 'test.decided', label: 'Every test has a verdict', check: 'auto', rule: { type: 'every_item_has_status' }, blocking: false },
      ],
      expected_artifacts: [{ kind: 'exploration_tests', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'critic', reason: 'Looks for where the reasoning breaks' }],
      skip_reasons: ['Nothing in this round needs testing yet'],
      transitions: { default_next: 'findings', allow_skip: true, allow_return_to: ['explore'] },
    },
    {
      id: 'findings',
      label: 'Findings',
      short_label: 'Findings',
      group: 'evaluation',
      required: true,
      renderer: 'prose',
      entry_guidance: 'What this round established, what broke, and how sure you are.',
      entry_prompt_hint:
        'State what this round established, what broke under testing and why, and what is still open — each with how confident it is and on what grounds. Keep earlier rounds’ findings that still stand, and say plainly where this round overturned one. A summary that only restates the reasoning, with no verdicts, is not findings.',
      exit_criteria: [
        { id: 'findings.written', label: 'The findings are written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'exploration_findings', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'analyst', reason: 'Separates what held from what is hoped' }],
      skip_reasons: [],
      transitions: { default_next: 'next_question', allow_skip: false, allow_return_to: ['explore', 'test'] },
    },
    {
      id: 'next_question',
      label: 'Next question',
      short_label: 'Next',
      group: 'revision',
      required: true,
      renderer: 'prose',
      entry_guidance: 'The question the next round should take on. Start the next round, or move on to the write-up.',
      entry_prompt_hint:
        'From the findings, choose the single most promising next question: the one whose answer would move the idea furthest, and that a round of reasoning can actually progress. Say why it beats the alternatives you set aside. A list of every open question is not a choice.',
      exit_criteria: [
        { id: 'next.written', label: 'The next question is chosen', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'exploration_next', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'architect', reason: 'Chooses where the next round builds' }],
      skip_reasons: [],
      transitions: { default_next: 'write_up', allow_skip: false, allow_return_to: ['findings'], loop_to: 'explore' },
    },
    {
      id: 'write_up',
      label: 'Write-up',
      short_label: 'Write-up',
      group: 'final_review',
      required: true,
      renderer: 'prose',
      entry_guidance: 'Where the idea stands now: what was found, how, and what is still open.',
      entry_prompt_hint:
        'Write up where the idea stands after every round: the question, what was established and how, what broke, what remains open, and the most promising next steps. Distinguish established results from speculation throughout. Claiming more certainty than the rounds earned is the failure to avoid.',
      exit_criteria: [
        { id: 'write_up.written', label: 'The write-up is written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
        { id: 'write_up.approved', label: 'I approve this as where the idea stands', check: 'manual', authority: 'reserved', blocking: true },
      ],
      expected_artifacts: [{ kind: 'exploration_write_up', cardinality: 'one', primary: true }],
      recommended_modes: [{ mode: 'clarity', reason: 'Makes the result readable by someone new' }],
      skip_reasons: [],
      transitions: { default_next: null, allow_skip: false, allow_return_to: ['next_question'] },
    },
  ],
};
