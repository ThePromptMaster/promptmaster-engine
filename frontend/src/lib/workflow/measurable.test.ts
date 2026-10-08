import { describe, expect, it } from 'vitest';

import { countQuestions, countWords, measure, parseRequirements, requirementsForStage, sectionFor } from './measurable';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { StageDefinition } from './types';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('requirements PromptMaster can measure (C1; Sean, 7 Oct)', () => {
  it('reads word ranges, limits and question counts, naming what they are about', () => {
    const reqs = parseRequirements([
      'Produce a 120–180-word customer announcement and a support FAQ with exactly five questions, using only supplied facts.',
      'Keep the summary under 300 words.',
    ]);
    expect(reqs).toEqual([
      expect.objectContaining({ kind: 'words', subject: 'announcement', min: 120, max: 180 }),
      expect.objectContaining({ kind: 'questions', subject: 'faq', min: 5, max: 5, answered: true }),
      expect.objectContaining({ kind: 'words', subject: 'summary', max: 300 }),
    ]);
    expect(parseRequirements(['a 100-140 word announcement and a five-question support FAQ'])).toEqual([
      expect.objectContaining({ kind: 'words', subject: 'announcement', min: 100, max: 140 }),
      expect.objectContaining({ kind: 'questions', subject: 'faq', min: 5 }),
    ]);
  });

  it('recognises nothing in a sentence that states no measure', () => {
    expect(parseRequirements(['The objective required three cycles: reject a formula, prove it, check four values.'])).toEqual([]);
    expect(parseRequirements(['Answer the five questions the board asked.'])).toEqual([]);
  });

  it('counts words by whitespace, leaving out headings and notes about the text', () => {
    const text = `## Announcement\n${words(95)}\n\nWhat changed: kept the facts, shortened the close.\nWord count: 105`;
    expect(countWords(text)).toBe(95);
  });

  it('finds the part a requirement is about under its heading', () => {
    const text = `# Announcement\n${words(95)}\n\n# Support FAQ\n**Q1. When does it launch?**\nOn December 10.\n### Q2. What does it cost?\n`;
    expect(countWords(sectionFor(text, 'announcement')!)).toBe(95);
    expect(countQuestions(sectionFor(text, 'faq')!)).toEqual({ total: 2, answered: 1 });
    expect(sectionFor(text, 'summary')).toBeNull();
  });

  it('TaskBoard: 95 words against 100–140, five questions without answers', () => {
    const [w, q] = parseRequirements(['a 100–140-word announcement and a five-question support FAQ']);
    const text = `## Announcement\n${words(95)}\n\n## FAQ\n1. When?\n2. How much?\n3. Who?\n4. Where?\n5. Trial?\n`;
    expect(measure(w, text)).toEqual({ id: 'measured.words:announcement', label: 'Announcement: 100–140 words', satisfied: false, detail: '95 words' });
    expect(measure(q, text)).toEqual({ id: 'measured.questions:faq', label: 'FAQ: exactly 5 questions, each answered', satisfied: false, detail: '5 without an answer' });
  });

  it('TeamNotes: the announcement stage is measured whole; a heading is not needed', () => {
    const [w] = parseRequirements(['a 120–180-word announcement']);
    const stage = { id: 'announcement', label: 'Draft customer announcement', renderer: 'prose', expected_artifacts: [] } as unknown as StageDefinition;
    const [{ whole }] = requirementsForStage(stage, 'final', [w]);
    expect(measure(w, words(94), whole)).toMatchObject({ satisfied: false, detail: '94 words' });
    expect(measure(w, words(136), whole)).toMatchObject({ satisfied: true });
  });

  it('applies to the deliverable and to stages about it — never to the prompt it was made from', () => {
    const reqs = parseRequirements(['a 100–140-word announcement']);
    const stage = (id: string) => SINGLE_OUTPUT_V1.stages.find((s) => s.id === id)!;
    expect(requirementsForStage(stage('output'), 'output', reqs)).toHaveLength(1);
    expect(requirementsForStage(stage('review'), 'output', reqs)).toHaveLength(0);
    expect(requirementsForStage(stage('summary'), 'output', reqs)).toHaveLength(0);
  });
});
