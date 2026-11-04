/**
 * 4 Nov (production pass of Sean's support-software memo, guest b526be84).
 * The setup said "Complete decision memo under 500 words, including headings
 * and tables", read as "Memo: at most 500 words". The designed workflow's
 * first stage is "Memo brief and success test": its label names the memo, so
 * the memo's limit was held against the brief. A 669-word brief was repaired
 * twice to 558 and 549 words, and Go stopped: "The last 2 steps failed".
 */
import { describe, expect, it } from 'vitest';

import { parseRequirements, preparesFor, requirementsForStage } from './measurable';
import type { StageDefinition } from './types';

const stage = (id: string, label: string, hint = ''): StageDefinition =>
  ({ id, label, renderer: 'prose', entry_prompt_hint: hint, expected_artifacts: [], exit_criteria: [], transitions: { default_next: null, allow_return_to: [] } }) as unknown as StageDefinition;

const reqs = parseRequirements([
  'Complete decision memo under 500 words, including headings and tables. It must contain a comparison of A, B and C.',
  'Keep the memo under 500 words, including headings and tables.',
]);

describe('a stage that prepares the deliverable is not held to its length', () => {
  it('reads the limit as the memo\'s', () => {
    expect(reqs.some((r) => r.kind === 'words' && r.subject === 'memo' && r.max === 500)).toBe(true);
  });

  it('the brief and success test, an outline or a plan for it answer for none of it', () => {
    const brief = stage('memo_brief_and_success_test', 'Memo brief and success test', "Write a short brief. State the objective in the user's words: a decision memo for choosing a plan.");
    expect(requirementsForStage(brief, 'final_decision_memo', reqs)).toEqual([]);
    expect(requirementsForStage(stage('o', 'Memo outline'), 'final', reqs)).toEqual([]);
    expect(requirementsForStage(stage('b', 'Brief', 'A brief for the decision memo'), 'final', reqs)).toEqual([]);
  });

  it('the draft and the final memo still do', () => {
    const draft = stage('draft_decision_memo', 'Draft decision memo', 'Write the full memo in under 500 words, including headings and tables.');
    expect(requirementsForStage(draft, 'final_decision_memo', reqs).length).toBeGreaterThan(0);
    const final = stage('final_decision_memo', 'Final decision memo', 'Rewrite the memo with every accepted finding applied.');
    expect(requirementsForStage(final, 'final_decision_memo', reqs).length).toBeGreaterThan(0);
  });

  it('a stage that is the thing asked for, though its name is a preparing word, still answers for it', () => {
    expect(preparesFor('Research plan', 'research plan')).toBe(false);
    expect(preparesFor('Final research plan', 'research plan')).toBe(false);
    expect(preparesFor('Research plan', 'report')).toBe(true);
    expect(preparesFor('Draft decision memo', 'memo')).toBe(false);
    expect(preparesFor('Memo brief and success test', 'memo')).toBe(true);
  });
});

describe('the deliverable\'s own limit beside a limit on one of its parts (4 Nov, prod check)', () => {
  // "Produce a decision memo under 500 words … The executive summary must be no more than 60 words."
  const both = parseRequirements(['Keep the memo under 500 words, including headings and tables. The executive summary must be no more than 60 words.']);
  const answer = stage('answer', 'Answer');

  it('counts the memo on the whole text, and the summary only under its own heading', () => {
    const out = requirementsForStage(answer, 'answer', both);
    const memo = out.find((o) => o.requirement.subject === 'memo');
    const summary = out.find((o) => o.requirement.subject !== 'memo');
    expect(memo?.whole).toBe(true);
    expect(summary?.whole).toBe(false);
  });

  it('a summary asked for on its own is still the whole text', () => {
    const alone = parseRequirements(['Write a summary of no more than 120 words.']);
    expect(requirementsForStage(answer, 'answer', alone)[0].whole).toBe(true);
  });

  it('two names for the deliverable are still ambiguous, and neither is taken as the whole', () => {
    const two = parseRequirements(['The memo must be under 500 words. The report must be under 900 words.']);
    expect(requirementsForStage(answer, 'answer', two).every((o) => !o.whole)).toBe(true);
  });
});
