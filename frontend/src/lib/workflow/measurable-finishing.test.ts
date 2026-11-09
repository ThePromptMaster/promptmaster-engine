import { describe, expect, it } from 'vitest';

import { measuredLines, stageRequirements, unverifiedLimits } from './context';
import type { StageDefinition, WorkflowTemplate } from './types';

const stage = (id: string, renderer: StageDefinition['renderer']) => ({ id, label: id, short_label: id, renderer, group: 'drafting', required: true, exit_criteria: [], expected_artifacts: [], transitions: {} }) as unknown as StageDefinition;
const template = { key: 'c', stages: [stage('plan', 'outline'), stage('documents', 'long_form'), stage('package', 'prose')] } as unknown as WorkflowTemplate;
const project = { objective: 'Write a package.', constraints: '', output_format: '1. Brief; 2. Sponsor update email (no more than 200 words); 3. Handoff.', facts: [] };

describe('a limit on one document is counted on the stage that finishes the package (9 Nov, production)', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  it('counts the part under its heading', () => {
    const text = `# 1. Brief\n${words(900)}\n\n# 2. Sponsor update email\n${words(145)}\n\n# 3. Handoff\n${words(400)}`;
    expect(measuredLines(project, template, template.stages[2], text)).toEqual([expect.objectContaining({ label: 'Email: at most 200 words', met: true, value: expect.stringMatching(/^145 words/) })]);
  });

  it('never holds the whole package to the limit on a part', () => {
    expect(stageRequirements(project, template, template.stages[2])[0].whole).toBe(false);
    expect(measuredLines(project, template, template.stages[2], words(4000))).toEqual([]);
  });

  it('a short note in that stage is not reported as an uncounted limit', () => {
    expect(unverifiedLimits(project, template, template.stages[2], 'A note on the chapters.')).toEqual([]);
  });

  it('a workflow whose deliverable is a prose stage is read as before', () => {
    const single = { key: 's', stages: [stage('draft', 'prose')] } as unknown as WorkflowTemplate;
    expect(stageRequirements(project, single, single.stages[0])[0].requirement.subject).toBe('email');
  });
});
