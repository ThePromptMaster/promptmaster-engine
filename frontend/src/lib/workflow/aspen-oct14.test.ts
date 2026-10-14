/**
 * 14 Oct (Sean, ASPEN status pack): "Executive update must be no more than 100
 * words" was measured on the whole three-section pack (171 words), and Go's
 * repair cut the whole pack to fit. The limit is the update's; a repair of it
 * revises the update alone and puts every other section back in code.
 */
import { describe, expect, it } from 'vitest';

import { failingParts, onlyParts } from '@/lib/agent/perform';
import { checkCommit } from './commit-check';
import { measureStageContent } from './context';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { Project } from '@/types/project';

const project = {
  objective: 'Prepare a status pack for a fictional portfolio-company improvement project called ASPEN, as of November 2, 2026.',
  constraints:
    'As of November 2, 2026. Use only supplied facts and clearly labeled calculations. Deliver exactly three sections. Executive update must be no more than 100 words. Action tracker must contain exactly three actions with stable IDs A-001 to A-003 and specified columns.',
  output_format: 'Three-section status pack with a brief executive update and two markdown tables',
  facts: [],
} as unknown as Project;
const output = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'output')!;
const ctx = { project, template: SINGLE_OUTPUT_V1 };

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const TRACKER = '## 2. Action tracker\n\n| ID | Action | Owner |\n|---|---|---|\n| A-001 | Improve on-time delivery | Omar |';
const LOG = '## 3. Decision log\n\n| ID | Decision | Status |\n|---|---|---|\n| D-001 | Completion target | Approved: December 18, 2026 |';
const pack = (update: string) => `## 1. Executive update\n\n${update}\n\n${TRACKER}\n\n${LOG}`;

describe('ASPEN: the update’s limit is measured on the update', () => {
  it('an 81-word update passes, whatever the tables add', () => {
    const m = measureStageContent(project, SINGLE_OUTPUT_V1, output, pack(words(81)));
    expect(m.find((x) => x.label.startsWith('Executive update'))).toMatchObject({ satisfied: true });
    expect(m.every((x) => x.satisfied)).toBe(true);
  });

  it('a 130-word update fails as the update, not as the deliverable', () => {
    const m = measureStageContent(project, SINGLE_OUTPUT_V1, output, pack(words(130)));
    const failed = m.filter((x) => !x.satisfied);
    expect(failed.map((x) => x.label)).toEqual(['Executive update: at most 100 words']);
  });
});

describe('ASPEN: a repair revises the update and nothing else', () => {
  const head = pack(words(130));

  it('names the update as the one part to revise', () => {
    expect(failingParts(ctx, output, head).map((r) => r.subject)).toEqual(['executive update']);
  });

  it('keeps the tracker and the log exactly, even when the model rewrote them', () => {
    const generated = `What changed: shortened the update.\n\n## 1. Executive update\n\n${words(90)}\n\n## 2. Action tracker\n\n| ID | Action |\n|---|---|\n| A-001 | shortened |\n\n## 3. Decision log\n\nnothing`;
    const out = onlyParts(head, generated, failingParts(ctx, output, head));
    expect(out.startsWith('What changed: shortened the update.')).toBe(true);
    expect(out).toContain(TRACKER);
    expect(out).toContain(LOG);
    expect(out).toContain(words(90));
    expect(out).not.toContain(words(130));
    expect(measureStageContent(project, SINGLE_OUTPUT_V1, output, out).every((x) => x.satisfied)).toBe(true);
  });

  it('revises the whole text when something besides a part fails', () => {
    const twoSections = `## 1. Executive update\n\n${words(130)}\n\n${TRACKER}`;
    expect(failingParts(ctx, output, twoSections)).toEqual([]);
  });
});

describe('ASPEN: a refused revision says what changed the stage', () => {
  it('names the draft started when the stage opened', () => {
    const msg = checkCommit({ before: 'the opening draft', after: 'Go’s draft', operation: 'agent_draft', base: '', beforeOperation: 'stage_draft' });
    expect(msg).toBe('The stage changed while this revision was being made (the draft started when the stage opened was saved meanwhile), so nothing was overwritten');
  });
});
