/**
 * 4 Nov (Sean, support-software memo): "I'd also count hard word limits against
 * the actual version being reviewed, including headings and tables when
 * required. The manual check estimated roughly 480 words and declared the memo
 * under 500 without counting. If a measurement hasn't run, show the limit as
 * unverified."
 */
import { describe, expect, it } from 'vitest';

import { evaluateStage } from './engine';
import { measuredLines, unverifiedLimits, NOT_COUNTED } from './context';
import { countWords } from './measurable';
import { withoutHandCounts } from './stage-requests';
import type { EvaluateStageArtifactResponse } from '@/types';
import type { StageDefinition, WorkflowTemplate } from './types';

const stage = (id: string, label: string, renderer = 'prose'): StageDefinition =>
  ({ id, label, renderer, required: true, entry_prompt_hint: '', expected_artifacts: [], exit_criteria: [], transitions: { default_next: null, allow_return_to: [] } }) as unknown as StageDefinition;
const draft = stage('draft_decision_memo', 'Draft decision memo');
const final = stage('final_decision_memo', 'Final decision memo');
const template = { key: 'custom_x', stages: [draft, stage('check', 'Check memo against brief', 'review'), final] } as unknown as WorkflowTemplate;
const project = {
  objective: 'Create a decision memo for choosing a customer-support software plan.',
  constraints: 'Keep the memo under 500 words, including headings and tables. The executive update must be no more than 60 words.',
  output_format: '',
};
const body = Array.from({ length: 470 }, () => 'word').join(' ');
const memo = `# Decision memo\n\n## Facts\n\n${body}`;

describe('a check is given the count code made, and a limit it could not count is not verified', () => {
  it('measures the memo on the version under review, headings included', () => {
    const lines = measuredLines(project, template, final, memo);
    expect(lines).toContainEqual({ label: 'Memo: at most 500 words (headings included)', value: `${countWords(memo, { headings: true })} words`, met: true });
  });

  it('a named part with no heading of its own is not verified, never estimated', () => {
    expect(unverifiedLimits(project, template, final, memo).map((m) => m.label)).toEqual(['Executive update: at most 60 words — not verified']);
    expect(measuredLines(project, template, final, memo)).toContainEqual({ label: 'Executive update: at most 60 words', value: NOT_COUNTED, met: null });
    // With a heading for it, it is counted.
    const headed = `${memo}\n\n## Executive update\n\nTwelve words of update here for the board to read before the meeting.`;
    expect(unverifiedLimits(project, template, final, headed)).toEqual([]);
  });

  it('the checklist says "not verified" and holds nothing up', () => {
    const ev = evaluateStage(template, 'final_decision_memo', {
      unverified: { final_decision_memo: unverifiedLimits(project, template, final, memo) },
    } as never);
    const row = ev.criteria.find((c) => c.id.startsWith('unverified.'))!;
    expect(row.label).toBe('Executive update: at most 60 words — not verified');
    expect(row.satisfied).toBe(false);
    expect(row.blocking).toBe(false);
    expect(ev.canAdvance).toBe(true);
  });

  it("drops a check's own estimate of a length code counted, and keeps it when nothing was counted", () => {
    const response = {
      evaluation: {
        findings: [
          { id: 'f5', category: 'length', summary: 'Estimated length is about 470–490 words, including headings and tables. No word count was run.', suggested_change: 'Recheck the length.' },
          { id: 'f6', category: 'accuracy', summary: 'C is said to "produce evidence".', suggested_change: 'Say it collects evidence.' },
        ],
      },
    } as unknown as EvaluateStageArtifactResponse;
    const counted = withoutHandCounts(response, measuredLines(project, template, final, memo));
    expect(counted.evaluation.findings!.map((f) => f.id)).toEqual(['f6']);
    expect(withoutHandCounts(response, []).evaluation.findings!.map((f) => f.id)).toEqual(['f5', 'f6']);
  });

  it('the text\'s own estimate of itself is not counted as part of it', () => {
    const noted = `${memo}\n\nWord count: roughly 480 words including headings and tables.\n\nThe memo is about 490 words by my count.`;
    expect(countWords(noted)).toBe(countWords(memo));
  });
});

describe('every text a check reads is counted, limit or not (12 Nov, an acquisition memo)', () => {
  // The limit named the final memo, the check read the draft: with no count it
  // estimated "roughly 560–600 words, by hand reading only".
  const screening = stage('draft_memo_and_questions', 'Draft memo and diligence questions');
  const recommendation = stage('recommendation', 'Recurring revenue and recommendation');
  const check = stage('check_the_memo', 'Check the memo', 'review');
  const t = { key: 'custom_y', stages: [recommendation, screening, check, stage('final_screening_memo', 'Final screening memo')] } as unknown as WorkflowTemplate;
  const p = { objective: 'Prepare a concise acquisition-screening note.', constraints: 'Use only the facts supplied.', output_format: '' };
  const bundles = {
    recommendation: { versions: [{ content: Array.from({ length: 120 }, () => 'word').join(' ') }] },
    draft_memo_and_questions: { versions: [{ content: `# Memo\n\n${Array.from({ length: 588 }, () => 'word').join(' ')}` }] },
  } as never;

  it('gives the check a plain count of each written stage before it', async () => {
    const { checkedCounts } = await import('./stage-requests');
    expect(checkedCounts(p as never, t, bundles, check)).toEqual([
      { label: 'Recurring revenue and recommendation — length', value: '120 words', met: null, info: true },
      { label: 'Draft memo and diligence questions — length', value: '588 words', met: null, info: true },
    ]);
  });

  it('adds none where a limit was already counted on that text, or the stage is empty', async () => {
    const { checkedCounts } = await import('./stage-requests');
    const lines = checkedCounts(project as never, template, { draft_decision_memo: { versions: [{ content: memo }] } } as never, template.stages[1]);
    expect(lines.some((l) => l.info)).toBe(false);
    expect(lines.some((l) => l.met !== null && /words/.test(l.value))).toBe(true);
    expect(checkedCounts(p as never, t, {} as never, check)).toEqual([]);
  });

  it('a plain count is enough for a finding that only estimates the length to be dropped', () => {
    const response = { evaluation: { findings: [{ summary: 'The body runs to roughly 560–600 words, by hand reading only.' }, { summary: 'The table omits the threshold.' }] } } as unknown as EvaluateStageArtifactResponse;
    const kept = withoutHandCounts(response, [{ label: 'Draft memo — length', value: '588 words', met: null, info: true }]);
    expect(kept.evaluation.findings?.map((f) => f.summary)).toEqual(['The table omits the threshold.']);
  });
});
