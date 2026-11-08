import { describeLengthTarget, wholeLengthTarget } from './measurable';
import { describe, expect, it } from 'vitest';

import { isPart, countQuestions, countSections, countWords, measure, parseRequirements, requirementsForStage, sectionFor, type MeasurableRequirement } from './measurable';
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

  it('reads an approximate range as a target, not a limit (2 Nov, library report)', () => {
    // The setup the start conversation wrote: the 4,500–5,000 was read as a
    // limit named "roughly", held against the outline, and Go stopped.
    const constraints =
      'About 14,000 words in twelve sections with ## headings: about four on the history of US public libraries (roughly 4,500–5,000 words) and about eight on the present, the future and recommendations.';
    const reqs = parseRequirements([constraints]);
    expect(reqs.filter((r) => r.kind === 'words')).toEqual([]);
    expect(reqs).toEqual([expect.objectContaining({ kind: 'sections', min: 12, max: 12 })]);
    for (const text of ['about 300–400 words', 'around 120 to 180 words', 'a roughly 250-word summary', 'approximately 200-300 words', '~150–200 words', '约200-300字']) {
      expect(parseRequirements([text]), text).toEqual([]);
    }
    // A firm range or limit is still a limit.
    expect(parseRequirements(['a 100-140 word announcement'])).toEqual([expect.objectContaining({ kind: 'words', subject: 'announcement', min: 100, max: 140 })]);
    expect(parseRequirements(['Keep the summary under about 300 words; the memo at most 400 words.'])).toEqual([
      expect.objectContaining({ kind: 'words', subject: 'memo', max: 400 }),
    ]);
  });

  it('holds no outline to a range the brief only gives as a target', () => {
    const outline = {
      id: 'outline', label: 'Twelve-section outline', renderer: 'prose',
      entry_prompt_hint: 'The targets should total about 14,000, with roughly 4,500 to 5,000 words for history.',
      exit_criteria: [], expected_artifacts: [], group: 'drafting', required: true, transitions: {},
    } as unknown as StageDefinition;
    const reqs = parseRequirements(['about four on the history (roughly 4,500–5,000 words) and about eight on the future']);
    expect(requirementsForStage(outline, 'final', reqs)).toEqual([]);
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
  it('reads a hoped-for page as no limit, and the firm figure beside it as one', () => {
    const pages = (text: string) => parseRequirements([text]).filter((r) => r.kind === 'pages').map((r) => r.max);
    expect(pages('One page if it can be, two pages at most.')).toEqual([2]);
    expect(pages('Ideally one page.')).toEqual([]);
    expect(pages('Roughly one page.')).toEqual([]);
    expect(pages('One page or so.')).toEqual([]);
    expect(pages('A one-page plan.')).toEqual([1]);
  });

  it('judges a page on the figure it shows, so an estimate does not fail by two words', () => {
    const [r] = parseRequirements(['A one-page plan.']).filter((x) => x.kind === 'pages');
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
    expect(measure(r, words(552), true)).toMatchObject({ satisfied: true });
    expect(measure(r, words(590), true)).toMatchObject({ satisfied: false });
  });

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

describe('a part named before "must be" (14 Oct, Sean: ASPEN status pack)', () => {
  // The constraints exactly as Sean entered them.
  const CONSTRAINTS =
    'As of November 2, 2026. Use only supplied facts and clearly labeled calculations. Deliver exactly three sections. Executive update must be no more than 100 words. Action tracker must contain exactly three actions with stable IDs A-001 to A-003 and specified columns. Decision log must use stable IDs D-001 to D-003 and record only the approved completion target, Elena’s authority to change it, and the approved budget.';
  // The update from his screenshot: 81 words by whitespace.
  const UPDATE =
    'As of November 2, 2026, ASPEN is led by COO Maya. Delivery is 86% on-time against a 95% goal. Staffing has filled two of three maintenance vacancies; one remains. Reporting dashboard is built, but reconciliation to underlying records is incomplete. Actual expenditure to date is $41,000, against an approved budget of $90,000 and forecast total expenditure of $96,000. No budget increase has been approved. Maya estimates potential annual savings of $18,000; Finance has not verified the estimate or any realized savings.';
  const PACK = `## 1. Executive update\n\n${UPDATE}\n\n## 2. Action tracker\n\n| ID | Action | Owner | Target | Open/Complete | Evidence |\n|---|---|---|---|---|---|\n| A-001 | Improve on-time delivery toward 95% goal | Omar | November 30, 2026 | Open | Latest on-time delivery is 86%; goal is 95%. |\n| A-002 | Fill remaining maintenance vacancy | Luis | November 20, 2026 | Open | Two of three maintenance vacancies are filled; one remains. |\n\n## 3. Decision log\n\n| ID | Decision | Status |\n|---|---|---|\n| D-001 | Completion target | Approved: December 18, 2026 |`;

  it('reads the limit as the executive update’s', () => {
    expect(parseRequirements([CONSTRAINTS]).find((r) => r.kind === 'words')).toMatchObject({ subject: 'executive update', max: 100 });
  });

  it('measures only the update: 81 words, met', () => {
    const reqs = parseRequirements([CONSTRAINTS]);
    const deliverable = { id: 'output', label: 'Output and evaluation', renderer: 'prose', expected_artifacts: [] } as unknown as StageDefinition;
    const ms = requirementsForStage(deliverable, 'output', reqs).map(({ requirement, whole }) => measure(requirement, PACK, whole));
    const words = ms.find((m) => m?.id === 'measured.words:executive update')!;
    expect(words.label).toBe('Executive update: at most 100 words');
    expect(words.satisfied).toBe(true);
    expect(words.value!.startsWith('81 words')).toBe(true);
    expect(ms.find((m) => m?.id === 'measured.sections:all')?.satisfied).toBe(true);
  });

  it('never measures a part as the whole pack when its heading is missing', () => {
    const reqs = parseRequirements(['Executive update must be no more than 100 words.']);
    const deliverable = { id: 'output', label: 'Output and evaluation', renderer: 'prose', expected_artifacts: [] } as unknown as StageDefinition;
    const [only] = requirementsForStage(deliverable, 'output', reqs);
    expect(only.whole).toBe(false);
    expect(measure(only.requirement, `## Summary\n${UPDATE}\n\n## Tracker\ntext`, only.whole)).toBeNull();
  });

  it.each([
    ['Section 1 (executive update) is limited to 100 words.', 'executive update'],
    ['Section 1, the executive update, must be no more than 100 words.', 'executive update'],
    ['Section 2 is limited to 80 words.', 'section 2'],
    ['The executive update should be under 100 words.', 'executive update'],
    ['The deliverable must be under 300 words.', ''],
    ['Keep it under 300 words.', ''],
    ['A survey kickoff brief under 30 words', ''],
    ['1. Executive update: no more than 100 words. This limit applies ONLY to this section.', 'executive update'],
    ['Executive summary: under 250 words.', 'summary'],
    ['Write a launch announcement (100-140 words) and an FAQ.', 'announcement'],
  ])('%s', (text, subject) => {
    expect(parseRequirements([text]).find((x) => x.kind === 'words')!.subject).toBe(subject);
  });

  it('measures a numbered section by position', () => {
    const r = parseRequirements(['Section 2 is limited to 5 words.']).find((x) => x.kind === 'words')!;
    const m = measure(r, '# Pack\n\n## One\na b c d e f g h\n\n## Two\none two three\n\n## Three\nx y z w v u', false)!;
    expect(m.satisfied).toBe(true);
    expect(m.value!.startsWith('3 words')).toBe(true);
  });
});

describe('limits written into a list of deliverables (17 Oct, Sean: FIELDGUIDE)', () => {
  // The constraints exactly as Sean entered them.
  const CONSTRAINTS =
    "Develop and maintain a decision-ready design package for a fictional executive-search firm's recruiter training program. Deliver five connected outputs: a decision memo (≤400 words), a three-workshop curriculum (≤900 words), one fictional practice case with interview exercise, sample summary, and facilitator notes (≤900 words), a pilot evaluation plan (≤500 words), and a compact project register. Use only confirmed facts plus labeled design assumptions where needed.";
  const FACT = 'Each section has its own separate word limit; there is no 500-word limit on the complete package.';
  const PACKAGE = `# FIELDGUIDE design package\n\n## 1. Decision memo\n\n${words(380)}\n\n## 2. Three-workshop curriculum\n\n${words(880)}\n\n## 3. Fictional practice case\n\n${words(700)}\n\n## 4. Pilot evaluation plan\n\n${words(450)}\n\n## 5. Project register\n\n${words(300)}`;

  it('reads each limit as its own deliverable’s, and none as the whole package’s', () => {
    const reqs = parseRequirements([CONSTRAINTS]).filter((r) => r.kind === 'words');
    expect(reqs.map((r) => [r.subject, r.max])).toEqual([
      ['memo', 400],
      ['curriculum', 900],
      ['practice case', 900],
      ['evaluation plan', 500],
    ]);
  });

  it('measures each section on the package, all met; nothing measures the whole', async () => {
    const { governingRequirements } = await import('./context');
    const reqs = governingRequirements('', parseRequirements([CONSTRAINTS]), [parseRequirements([FACT])]);
    const deliverable = { id: 'output', label: 'Output', renderer: 'prose', expected_artifacts: [] } as unknown as StageDefinition;
    const ms = requirementsForStage(deliverable, 'output', reqs).map(({ requirement, whole }) => measure(requirement, PACKAGE, whole));
    expect(ms.map((m) => [m?.id, m?.satisfied])).toEqual([
      ['measured.words:memo', true],
      ['measured.words:curriculum', true],
      ['measured.words:practice case', true],
      ['measured.words:evaluation plan', true],
    ]);
  });

  it('a part’s subheadings are inside it, even one naming a summary', () => {
    const r = parseRequirements([CONSTRAINTS]).find((x) => x.subject === 'practice case')!;
    const pack = `# 1. Executive decision memo\n\n${words(10)}\n\n# 3. Fictional practice case\n\n## Case scenario\n\n${words(20)}\n\n## Sample candidate summary\n\n${words(30)}\n\n## Facilitator notes\n\n${words(40)}\n\n# 4. Pilot evaluation plan\n\n${words(5)}`;
    expect(measure(r, pack, false)!.value!.startsWith('90 words')).toBe(true);
  });

  it('the clarification retires a whole-package limit instead of creating one', async () => {
    const { governingRequirements } = await import('./context');
    expect(parseRequirements([FACT])).toEqual([expect.objectContaining({ id: 'words:all', retires: true, max: 500 })]);
    const brief = parseRequirements(['The package must be under 500 words in total.']);
    expect(brief.map((r) => r.id)).toEqual(['words:all']);
    expect(governingRequirements('', brief, [parseRequirements([FACT])])).toEqual([]);
    // A different whole limit is not what the clarification speaks of.
    const other = parseRequirements(['The package must be under 3000 words in total.']);
    expect(governingRequirements('', other, [parseRequirements([FACT])]).map((r) => r.max)).toEqual([3000]);
  });

  it('a limit it cannot name, beside named ones, is not taken for the whole', () => {
    const reqs = parseRequirements(['A memo (≤400 words), a register (≤300 words), and supporting notes, under 500 words.']);
    expect(reqs.filter((r) => r.kind === 'words').map((r) => r.subject)).toEqual(['memo', 'register']);
    // Unless the sentence says the limit is on the whole.
    expect(parseRequirements(['A memo (≤400 words). The package is at most 1500 words in total.']).map((r) => r.subject).sort()).toEqual(['', 'memo']);
  });
});

describe('Chinese is counted in characters (Sean, 24 Oct: Mandarin)', () => {
  it('counts each character, and Latin words or figures run in among them', () => {
    expect(countWords('茶是一种饮料。')).toBe(6);
    expect(countWords('我们用 AI 写了 3 份报告')).toBe(10);
    expect(countWords('Tea is a drink.')).toBe(4);
  });

  it('reads a Chinese character limit', () => {
    const limit = (t: string) => parseRequirements([t]).find((r) => r.kind === 'words');
    expect(limit('写一篇不超过200字的说明')).toMatchObject({ max: 200 });
    expect(limit('全文200字以内')).toMatchObject({ max: 200 });
    expect(limit('字数不超过300')).toMatchObject({ max: 300 });
    expect(limit('至少500字')).toMatchObject({ min: 500 });
    expect(limit('200-300字')).toMatchObject({ min: 200, max: 300 });
  });
});

describe('questions end in any of the question marks (24 Oct)', () => {
  it('counts Chinese and Arabic questions', () => {
    expect(countQuestions('1. 你的预算是多少？\n2. 谁来批准？').total).toBe(2);
    expect(countQuestions('1. ما هي الميزانية؟').total).toBe(1);
    expect(countQuestions('1. What is the budget?').total).toBe(1);
  });
});

describe('the part a limit is counted on (5 Nov, a rollout pack)', () => {
  const email = { id: 'email', kind: 'words', subject: 'email', max: 130 } as MeasurableRequirement;
  const PACK = [
    '# Reporting Dashboard Pilot: Launch Drafts',
    '',
    '**DRAFT. Not approved to send or publish. Not ready to send: the date change and the email send are not approved.**',
    '',
    '---',
    '',
    '## 1. Internal Launch Brief',
    '',
    'For the rollout team. Do not send the customer email.',
    '',
    '---',
    '',
    '## 2. Customer Email',
    '',
    '**To:** Workspace admins',
    '',
    'Hello. On November 18 we will turn on access for you.',
    '',
    '---',
    '',
    '## 3. Support FAQ',
    '',
    'Answers.',
  ].join('\n');

  it('a bold sentence that mentions it is not its heading, and a separator is not its text', () => {
    const m = measure(email, PACK, true)!;
    expect(m.value).toMatch(/^1\d words, counted /);
    expect(m.value).not.toContain('---');
    expect(m.satisfied).toBe(true);
  });

  it('a one-word bold label is still a heading', () => {
    expect(measure(email, '**Email.**\n\nHello there, this is the text.\n\n**Other.**\n\nMore.', false)!.value).toMatch(/^6 words/);
  });

  it('the first heading naming it with words under it wins, over one with nothing under it', () => {
    const text = '## Email\n\n---\n\n## Customer email\n\nHello there friend.\n';
    expect(measure(email, text, false)!.value).toMatch(/^3 words/);
  });

  it('nothing to count under an upper limit says it could not be verified, never "0 words", met', () => {
    expect(measure(email, '## Email\n\n---\n\n## Other\n\nText.\n', false)).toBeNull();
    expect(measure(email, '## Email\n\n---\n\n## Other\n\nText.\n', true)).toBeNull();
  });

  it('with a minimum, an empty part still fails, so it is still repaired', () => {
    const m = measure({ ...email, min: 50 } as MeasurableRequirement, '## Email\n\n---\n\n## Other\n\nText.\n', false)!;
    expect(m.satisfied).toBe(false);
    expect(m.detail).toBe('0 words');
  });
});

describe('a limit on each chapter or section (6 Nov, a book test)', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const one = (text: string) => parseRequirements([text]);

  it('reads the ways it is written, and none of them as the whole document', () => {
    expect(one('Roughly 600–800 words per chapter.')).toEqual([
      expect.objectContaining({ id: 'words:each chapter', per: 'chapter', min: 600, max: 800, approximate: true, subject: '' }),
    ]);
    expect(one('Each section is capped at 150 words.')[0]).toMatchObject({ per: 'section', max: 150 });
    expect(one('Each section is capped at 150 words.')[0].approximate).toBeUndefined();
    expect(one('A guide with six chapters of 600-800 words.')[0]).toMatchObject({ per: 'chapter', min: 600, max: 800 });
    expect(one('Every slide must be no more than 40 words.')[0]).toMatchObject({ per: 'slide', max: 40 });
    expect(one('Six chapters, about 700 words each.')[0]).toMatchObject({ per: 'chapter', min: 700, max: 700, approximate: true });
    expect(one('Six 700-word chapters.')[0]).toMatchObject({ per: 'chapter', min: 700, max: 700, approximate: true });
    expect(one('700 words per module.')[0]).toMatchObject({ per: 'module', approximate: true });
    expect(one('Five sections, at most 200 words each.')[0]).toMatchObject({ per: 'section', max: 200 });
  });

  it('leaves alone what is not per anything', () => {
    expect(one('A report under 600 words in total.')[0]).toMatchObject({ subject: 'report', max: 600 });
    expect(one('A report under 600 words in total.')[0].per).toBeUndefined();
    // The limit is on the summary each chapter ends with.
    const summary = one('Each chapter ends with a summary of at most 100 words.');
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ subject: 'summary', max: 100 });
    expect(summary[0].per).toBeUndefined();
    // A hedged figure on the whole is still a target, measured nowhere (2 Nov).
    expect(one('About four sections on history (roughly 4,500–5,000 words).')).toEqual([]);
    expect(one('Write 700 words.').filter((r) => r.kind === 'words')).toEqual([]);
  });

  const BOOK = (counts: number[]) => `# The First 90 Days\n\n${counts.map((n, i) => `## ${i + 1}. Chapter title ${i + 1}\n\n${words(n)}`).join('\n\n')}`;

  it('counts each chapter of a manuscript and shows it, without the title', () => {
    const r = one('Roughly 600–800 words per chapter.')[0];
    expect(measure(r, BOOK([690, 787, 702]))).toEqual({
      id: 'measured.words:each chapter',
      label: 'Each chapter: roughly 600–800 words',
      satisfied: true,
      value: '3 chapters, 690–787 words each',
    });
  });

  it('says which ones are off, allowing what "roughly" allows and nothing for a firm limit', () => {
    const roughly = one('Roughly 600–800 words per chapter.')[0];
    expect(measure(roughly, BOOK([700, 900]))!.satisfied).toBe(true);
    const off = measure(roughly, BOOK([700, 400]))!;
    expect(off.satisfied).toBe(false);
    expect(off.detail).toBe('2. Chapter title 2: 400 words');
    const firm = one('Chapters of 600-800 words.')[0];
    expect(measure(firm, BOOK([700, 900]))!.satisfied).toBe(false);
  });

  it('prefers headings that name the unit, and leaves what follows the work out', () => {
    const r = one('Each chapter is at most 100 words.')[0];
    const text = `# Book\n\n## Foreword\n\n${words(500)}\n\n## Chapter 1\n\n${words(50)}\n\n## Chapter 2\n\n${words(60)}\n\n## Review note\n\n${words(500)}`;
    expect(measure(r, text)).toMatchObject({ satisfied: true, value: '2 chapters, 50–60 words each' });
    const sections = one('Each section is at most 100 words.')[0];
    const pack = `# Pack\n\n## Plan\n\n${words(80)}\n\n## Risks\n\n${words(90)}\n\n## Sources\n\n${words(500)}`;
    expect(measure(sections, pack)).toMatchObject({ satisfied: true, value: '2 sections, 80–90 words each' });
  });

  it('cannot verify a text with no such parts', () => {
    expect(measure(one('Each section is at most 100 words.')[0], words(50))).toBeNull();
  });

  it('holds a stage to a firm limit on each part, never to a hedged one, and never the whole to either', () => {
    const deliverable = { id: 'output', label: 'Output', renderer: 'prose', expected_artifacts: [] } as unknown as StageDefinition;
    const firm = requirementsForStage(deliverable, 'output', one('Each section is at most 100 words.'));
    expect(firm.map((e) => e.requirement.per)).toEqual(['section']);
    expect(measure(firm[0].requirement, `## One\n\n${words(90)}\n\n## Two\n\n${words(90)}`, firm[0].whole)!.satisfied).toBe(true);
    expect(requirementsForStage(deliverable, 'output', one('Roughly 600–800 words per chapter.'))).toEqual([]);
  });
});

describe('a limit on the thing being written is a limit on all of it (6 Nov, production)', () => {
  const only = (text: string) => parseRequirements([text]);

  it.each(['essay', 'article', 'paper', 'note', 'proposal', 'speech', 'story', 'newsletter', 'write-up'])('the %s', (noun) => {
    const [r] = only(`The ${noun} must be exactly 2,137 words, not one more or fewer.`);
    expect(r).toMatchObject({ subject: '', min: 2137, max: 2137 });
    expect(isPart(r)).toBe(false);
    const counted = measure(r, Array.from({ length: 2137 }, () => 'word').join(' '), true);
    expect(counted?.satisfied).toBe(true);
  });

  it('a part is still a part', () => {
    expect(only('Speaker notes must be at most 40 words.')[0].subject).toBe('speaker note');
    expect(only('Cover note limited to 150 words.')[0].subject).toBe('cover note');
    expect(only('The executive update must be no more than 100 words.')[0].subject).toBe('executive update');
  });
});

describe('the whole document\'s hedged length, counted (8 Nov)', () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const project = { objective: 'A handoff.', constraints: 'The attendee email must be under 150 words.', output_format: 'Operations handoff package of roughly 900–1,200 words. It must contain a budget.' };

  it('counts the text against the range the brief hedges', () => {
    const t = wholeLengthTarget(project, body(1556));
    expect(t).toMatchObject({ said: 'roughly 900–1,200 words', max: 1200, count: 1556, over: true });
    expect(describeLengthTarget(t)).toBe('1,556 words, counted in code; the brief asks for roughly 900–1,200 words, so it is over');
  });

  it('a little over is still on target', () => {
    expect(wholeLengthTarget(project, body(1300))?.over).toBe(false);
  });

  it('a part\'s own length is not the whole\'s', () => {
    expect(wholeLengthTarget({ output_format: 'about 300 words per section' }, body(5000))).toBeNull();
    expect(wholeLengthTarget({ constraints: 'An email of roughly 200 words.' }, body(5000))).toBeNull();
  });

  it('a firm limit is not read here; it is measured elsewhere', () => {
    expect(wholeLengthTarget({ output_format: 'At most 500 words.' }, body(600))).toBeNull();
  });

  it('nothing to count, nothing said', () => {
    expect(wholeLengthTarget(project, '  ')).toBeNull();
    expect(describeLengthTarget(null)).toBe('');
  });
});

describe('a limit inside a plain list belongs to the item it closes (8 Nov, production)', () => {
  it('holds the email to it, not the first thing listed', () => {
    const reqs = parseRequirements(['Operations handoff package of roughly 900–1,200 words: delivery plan, staffing schedule, budget, attendee email (under 150 words), and handoff checklist for the person taking over']);
    const limited = reqs.filter((r) => r.max === 150);
    expect(limited.map((r) => r.subject)).toEqual(['email']);
  });

  it('an item with parts of its own still opens with what it is', () => {
    const reqs = parseRequirements(['a decision memo (≤400 words), one fictional practice case with interview exercise, sample summary, and facilitator notes (≤900 words), a pilot evaluation plan (≤500 words)']);
    expect(reqs.map((r) => r.subject)).toEqual(expect.arrayContaining(['memo', 'practice case', 'evaluation plan']));
  });
});

