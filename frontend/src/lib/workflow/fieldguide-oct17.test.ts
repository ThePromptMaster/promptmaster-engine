/**
 * 17 Oct (Sean, FIELDGUIDE): five deliverables with their own word limits.
 * Go held the whole package to the pilot plan's 500 words, and its two
 * repairs cut the package to fit, losing the curriculum's timed activities.
 * Each limit is its section's; a repair revises the failing section alone;
 * and a shortening that drops a heading or every timing is not saved.
 */
import { describe, expect, it } from 'vitest';

import { failingParts, onlyParts } from '@/lib/agent/perform';
import { measureStageContent } from './context';
import { measure, parseRequirements } from './measurable';
import { structureDropped } from './preservation';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { Project } from '@/types/project';

const project = {
  objective: 'Develop and maintain a decision-ready design for a fictional executive-search firm’s recruiter training program.',
  constraints:
    "Deliver five connected outputs: a decision memo (≤400 words), a three-workshop curriculum (≤900 words), one fictional practice case with interview exercise, sample summary, and facilitator notes (≤900 words), a pilot evaluation plan (≤500 words), and a compact project register.",
  output_format: 'Five-part design package in concise business prose with headings and a compact register',
  facts: [
    { id: 'f1', kind: 'requirement', statement: 'Each section has its own separate word limit; there is no 500-word limit on the complete package.', created_at: '2026-10-17T18:00:00Z' },
  ],
} as unknown as Project;
const output = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const ctx = { project, template: SINGLE_OUTPUT_V1 };

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const curriculum = (n: number) =>
  `# 2. Three-workshop curriculum\n\n## Workshop 1: Structured Interview Foundations\n\n- Opening (10 minutes)\n- Paired practice (35 minutes)\n- Debrief (15 minutes)\n\n${words(n)}`;
const pack = (n: number) =>
  `# 1. Executive decision memo\n\n${words(380)}\n\n${curriculum(n)}\n\n# 3. Fictional practice case\n\n${words(700)}\n\n# 4. Pilot evaluation plan\n\n${words(450)}\n\n# 5. Compact project register\n\n${words(300)}`;

describe('FIELDGUIDE: each section against its own limit', () => {
  it('a 2,254-word package with every section in limit passes', () => {
    const m = measureStageContent(project, SINGLE_OUTPUT_V1, output, pack(400));
    expect(m.map((x) => x.label)).toEqual([
      'Memo: at most 400 words',
      'Curriculum: at most 900 words',
      'Practice case: at most 900 words',
      'Evaluation plan: at most 500 words',
    ]);
    expect(m.every((x) => x.satisfied)).toBe(true);
  });

  it('an overlong curriculum fails as the curriculum, and only it is revised', () => {
    const head = pack(1000);
    expect(measureStageContent(project, SINGLE_OUTPUT_V1, output, head).filter((x) => !x.satisfied).map((x) => x.label)).toEqual(['Curriculum: at most 900 words']);
    const parts = failingParts(ctx, output, head);
    expect(parts.map((r) => r.subject)).toEqual(['curriculum']);
    const generated = `${curriculum(700)}\n\n# 4. Pilot evaluation plan\n\nrewritten`;
    const out = onlyParts(head, generated, parts);
    expect(out).toContain(`# 4. Pilot evaluation plan\n\n${words(450)}`);
    expect(measureStageContent(project, SINGLE_OUTPUT_V1, output, out).every((x) => x.satisfied)).toBe(true);
    expect(structureDropped(head, out)).toEqual([]);
  });

  it('a shortening that drops the timed activities is caught', () => {
    const head = pack(1000);
    const cut = head.replace(curriculum(1000), `# 2. Three-workshop curriculum\n\n## Workshop 1: Structured Interview Foundations\n\nOpening, practice and debrief.`);
    expect(structureDropped(head, cut)).toEqual(['the timings under "Workshop 1: Structured Interview Foundations"']);
  });
});

describe('word limits written as a list by a generated setup (19 Oct, simple start)', () => {
  const constraints = "Only the design package is authorized. Word limits: memo 400, curriculum 900, practice case 900, evaluation plan 500, register compact. Label assumptions.";
  const reqs = parseRequirements([constraints]);

  it('reads one limit per part, and nothing for a part with no number', () => {
    expect(reqs.map((r) => [r.subject, r.max])).toEqual([
      ['memo', 400], ['curriculum', 900], ['practice case', 900], ['evaluation plan', 500],
    ]);
  });

  it('measures each under its own heading in the package', () => {
    const pkg = [
      '## 1. Executive decision memo', 'word '.repeat(380),
      '## 2. Three-workshop curriculum', 'word '.repeat(950),
      '## 3. Practice case', 'word '.repeat(600),
      '## 4. Pilot evaluation plan', 'word '.repeat(450),
    ].join('\n');
    const byId = Object.fromEntries(reqs.map((r) => [r.subject, measure(r, pkg)]));
    expect(byId.memo?.satisfied).toBe(true);
    expect(byId.curriculum?.satisfied).toBe(false);
    expect(byId['practice case']?.satisfied).toBe(true);
    expect(byId['evaluation plan']?.satisfied).toBe(true);
  });
});

describe('a named part is counted whole: bold labels, tables and questions inside it are its content (19 Oct)', () => {
  const [curriculum] = parseRequirements(['Word limits: curriculum 900, memo 400.']);
  const pkg = [
    '## 1. Executive decision memo', 'word '.repeat(50),
    '## 2. Three-workshop curriculum',
    '**Roles.** One facilitator and two role-players.',
    '**Assumptions.**', '- ' + 'word '.repeat(300),
    '### Workshop 1', '| Time | Activity |', '|---|---|', '| 10 | Warm-up |',
    '1. What did the candidate own?', 'word '.repeat(600),
    '## 3. Practice case', 'word '.repeat(50),
  ].join('\n');

  it('counts past a bold label, a subheading, a table and a numbered question, to the next part', () => {
    const m = measure(curriculum, pkg)!;
    expect(m.satisfied).toBe(false);
    expect(m.value).toMatch(/^9\d\d words/);
  });
});
