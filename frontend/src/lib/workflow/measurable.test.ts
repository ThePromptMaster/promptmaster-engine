import { describe, expect, it } from 'vitest';

import { countQuestions, countSections, countWords, measure, parseRequirements, requirementsForStage, sectionFor } from './measurable';
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
    expect(measure(w, text)).toEqual({ id: 'measured.words:announcement', label: 'Announcement: 100–140 words', satisfied: false, detail: '95 words', value: '95 words, counted from “word0 word1 word2 word3 word4” to “word90 word91 word92 word93 word94”' });
    expect(measure(q, text)).toEqual({ id: 'measured.questions:faq', label: 'FAQ: exactly 5 questions, each answered', satisfied: false, detail: '5 without an answer', value: '5 questions, 0 answered' });
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

  it('a range in brackets belongs to the deliverable just before it (9 Oct, production)', () => {
    expect(parseRequirements(['Write a launch announcement (100-140 words) and a five-question support FAQ with answers'])).toEqual([
      expect.objectContaining({ kind: 'words', subject: 'announcement', min: 100, max: 140 }),
      expect.objectContaining({ kind: 'questions', subject: 'faq', min: 5 }),
    ]);
  });
});

describe('11 Oct, survey kickoff brief: 200 words, exactly four sections, labelled assumptions', () => {
  const brief = [
    '# Customer survey kickoff brief',
    '## Purpose',
    'Learn why customers renew and why some leave.',
    '## Roles',
    '- Survey lead: owns the questions.',
    '## Timeline',
    'Two weeks in the field, one week of analysis.',
    '## Assumptions',
    '- Assumption: the survey runs online.',
    'Assumption: responses are anonymous.',
  ].join('\n');

  it('reads "exactly four sections" and counts the sections under a title', () => {
    const reqs = parseRequirements(['A customer survey kickoff brief under 200 words, with exactly four sections, generic roles.']);
    expect(reqs.map((r) => [r.kind, r.subject, r.min, r.max])).toEqual([
      ['words', '', undefined, 200],
      ['sections', '', 4, 4],
    ]);
    expect(countSections(brief)).toBe(4);
    expect(countSections('## A\ntext\n## B\ntext')).toBe(2);
    expect(parseRequirements(['Summarise the four sections below.'])).toEqual([]);
  });

  it('counts labelled assumptions as words of the brief', () => {
    // 8 + 5 + 9 + 5 + 4 = 31 words of text; the headings are not counted.
    expect(countWords(brief)).toBe(31);
  });

  it('records the count whether or not the requirement is met', () => {
    const [words, sections] = parseRequirements(['under 200 words, with exactly four sections']);
    expect(measure(words, brief, true)).toMatchObject({ satisfied: true, value: '31 words' });
    expect(measure(sections, brief, true)).toMatchObject({ satisfied: true, value: '4 sections' });
  });
});

describe('11 Oct, production (lunch invitation): an accepted requirement fact governs the brief\'s figure', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  // As on production: the limit is a sentence away from what it limits, so it reads as the whole deliverable's.
  const OBJECTIVE = 'Write a lunch invitation for the whole team, for Wednesday at the usual place, menu attached. Keep it under 120 words.';
  const project = (facts: string[]) => ({
    objective: OBJECTIVE,
    constraints: '',
    facts: facts.map((statement, i) => ({ id: `f${i}`, statement, kind: 'requirement', retired_at: null }) as never),
  });
  const output = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;

  it('the fact\'s 70 words is measured, not the objective\'s 120', async () => {
    const { measureStageContent } = await import('./context');
    const ms = measureStageContent(project(['Requirement: The invitation is under 70 words.']), SINGLE_OUTPUT_V1, output, words(49));
    expect(ms).toEqual([expect.objectContaining({ label: 'The deliverable: at most 70 words', satisfied: true, value: '49 words' })]);
    const over = measureStageContent(project(['Requirement: The invitation is under 70 words.']), SINGLE_OUTPUT_V1, output, words(90));
    expect(over).toEqual([expect.objectContaining({ satisfied: false, detail: '90 words' })]);
  });

  it('a fact about the same subject replaces it; one about something else is added', async () => {
    const { governingRequirements } = await import('./context');
    expect(parseRequirements([OBJECTIVE]).map((r) => r.subject)).toEqual(['']);
    const near = 'Write a lunch invitation under 120 words.';
    const same = governingRequirements(near, parseRequirements([near]), [parseRequirements(['The invitation is under 70 words.'])]);
    expect(same.map((r) => [r.subject, r.max])).toEqual([['invitation', 70]]);
    const other = governingRequirements(OBJECTIVE, parseRequirements([OBJECTIVE]), [parseRequirements(['The FAQ has exactly 5 questions.'])]);
    expect(other.map((r) => [r.kind, r.subject, r.max])).toEqual([['words', '', 120], ['questions', 'faq', 5]]);
  });
});

describe('11 Oct, survey brief: the ways a word limit is written', () => {
  it.each([
    ['capped at 200 words'], ['limited to 200 words'], ['a limit of 200 words'], ['no longer than 200 words'],
    ['200 words max'], ['200 words or fewer'], ['a 200-word limit'], ['within 200 words'], ['maximum 200 words'],
  ])('reads "%s" as at most 200', (text) => {
    expect(parseRequirements([`A kickoff brief, ${text}.`]).map((r) => [r.kind, r.max])).toEqual([['words', 200]]);
  });
});

describe('"one page" is estimated in code (L-73, 11 Oct: onboarding plan)', () => {
  it('reads one-page and page limits', async () => {
    const { parseRequirements } = await import('./measurable');
    expect(parseRequirements(['A one-page onboarding plan with six sections.']).filter((r) => r.kind === 'pages').map((r) => r.max)).toEqual([1]);
    expect(parseRequirements(['Keep it to no more than two pages.']).filter((r) => r.kind === 'pages').map((r) => r.max)).toEqual([2]);
    expect(parseRequirements(['The four pages below explain it.']).filter((r) => r.kind === 'pages')).toEqual([]);
  });
  it('measures the estimate and says it is one', async () => {
    const { measure, parseRequirements, WORDS_PER_PAGE } = await import('./measurable');
    const [r] = parseRequirements(['A one-page plan.']).filter((x) => x.kind === 'pages');
    const short = measure(r, Array(300).fill('word').join(' '), true)!;
    expect(short).toMatchObject({ satisfied: true, label: 'The deliverable: at most 1 page (estimated)' });
    expect(short.value).toBe(`about 0.5 pages (300 words; estimated at ${WORDS_PER_PAGE} words a page)`);
    const long = measure(r, Array(900).fill('word').join(' '), true)!;
    expect(long.satisfied).toBe(false);
    expect(long.detail).toMatch(/^about 1.6 pages/);
  });
});

// --- 12 Oct (Sean, Cedar and Diligence): the summary, not the document --------

describe('a summary beside other parts', () => {
  const SUMMARY = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
  const TABLE = '| Item | Owner |\n|---|---|\n' + Array.from({ length: 5 }, (_, i) => `| row ${i} has several words here | owner ${i} |`).join('\n');
  const QUESTIONS = '1. What should the team decide about the vendor before Friday?\n2. Who owns the budget line for the new tooling next quarter?\n3. When does the pilot end and who signs it off?';
  const req = parseRequirements(['A summary of at most 100 words, followed by a five-row table and three questions.'])[0];

  it('reads the limit as the summary’s', () => {
    expect(req).toMatchObject({ kind: 'words', subject: 'summary', max: 100 });
  });

  it('measures only the summary under its heading, ending at a bold label, a table or questions', () => {
    for (const text of [
      `## Summary\n${SUMMARY}\n\n**Five-row table**\n${TABLE}\n\n**Questions**\n${QUESTIONS}`,
      `## Summary\n${SUMMARY}\n\n${TABLE}\n\n${QUESTIONS}`,
      `## Summary\n${SUMMARY}\n\n### Table\n${TABLE}\n\n### Questions\n${QUESTIONS}`,
      `# Cedar Summary\n\n## Summary\n${SUMMARY}\n\n## Table\n${TABLE}`,
    ]) {
      const m = measure(req, text, true)!;
      expect(m.value).toMatch(/^80 words, counted from “w0 w1 w2 w3 w4” to “w75 w76 w77 w78 w79”$/);
      expect(m.satisfied).toBe(true);
    }
  });

  it('with no summary heading, measures the opening prose rather than the whole document', () => {
    const m = measure(req, `# Project Cedar status\n\n${SUMMARY}\n\n${TABLE}\n\n${QUESTIONS}`, true)!;
    expect(m.value!.startsWith('80 words')).toBe(true);
  });

  it('a title naming the summary is not the section', () => {
    const m = measure(req, `# Cedar Summary\n\n${SUMMARY}\n\n## Table\n${TABLE}\n\n## Questions\n${QUESTIONS}`, true)!;
    expect(m.value!.startsWith('80 words')).toBe(true);
  });
});

describe('the Diligence phrasings', () => {
  it.each([
    ['A 250-word executive summary, then the full question pack.', 250],
    ['Executive summary ≤ 250 words.', 250],
    ['Keep the executive summary to 250 words.', 250],
    ['Keep it to 250 words in the summary.', 250],
  ])('%s', (text, max) => {
    expect(parseRequirements([text]).find((r) => r.kind === 'words')).toMatchObject({ subject: 'summary', max });
  });

  it('measures an overlength executive summary as over', () => {
    const req = parseRequirements(['A 250-word executive summary.'])[0];
    const long = Array.from({ length: 280 }, () => 'word').join(' ');
    const m = measure(req, `## Executive summary\n${long}\n\n## Q1. Ownership\nAnswer text here.`, true)!;
    expect(m.satisfied).toBe(false);
    expect(m.value!.startsWith('280 words')).toBe(true);
  });
});

describe('a limit on a part not in the known list (13 Oct, Sean: PINE status pack)', () => {
  const BRIEF =
    'As of November 2, 2026. Produce exactly three sections: executive update capped at 120 words, action tracker for the three named workstreams with stable action IDs, and a decision log with only supplied approved decisions.';
  const UPDATE = Array.from({ length: 98 }, () => 'word').join(' ');
  const PACK = `## Executive update\n\n${UPDATE}\n\n## Action tracker\n\n| ID | Owner |\n|---|---|\n| PINE-A01 | Omar |\n\n## Decision log\n\n| Item | Detail |\n|---|---|\n| PINE-D01 | Sponsor Elena approved a December 18, 2026 completion target. |`;

  it('reads the limit as the executive update’s, not the whole pack’s', () => {
    expect(parseRequirements([BRIEF]).find((r) => r.kind === 'words')).toMatchObject({ subject: 'executive update', max: 120 });
  });

  it('measures only the update: 98 words, met', () => {
    const req = parseRequirements([BRIEF]).find((r) => r.kind === 'words')!;
    const m = measure(req, PACK, false)!;
    expect(m.label).toBe('Executive update: at most 120 words');
    expect(m.satisfied).toBe(true);
    expect(m.value!.startsWith('98 words')).toBe(true);
  });

  it.each([
    ['The report must be under 500 words.', 'report'],
    ['Write it in under 500 words.', ''],
    ['Cover note limited to 150 words.', 'cover note'],
    ['Chapters capped at 3000 words.', 'chapter'],
  ])('%s', (text, subject) => {
    const r = parseRequirements([text]).find((x) => x.kind === 'words')!;
    expect(r.subject).toBe(subject);
  });
});
