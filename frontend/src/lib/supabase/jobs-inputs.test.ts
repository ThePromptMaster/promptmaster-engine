import { describe, expect, it } from 'vitest';

import { inputsFromProject } from './jobs';
import type { Project } from '@/types/project';

const project = {
  objective: 'A guide', audience: 'Managers', constraints: '', output_format: '', context: '', mode: 'architect',
  custom_name: '', custom_preamble: '', custom_tone: '', session_facts: '', language: 'en',
} as unknown as Project;

describe('what a chapter job is told', () => {
  it('carries the user\'s sample, so chapters match it as the browser\'s stages do', () => {
    expect(inputsFromProject({ ...project, sample_output: 'Short sentences. No jargon.' }).sample_output).toBe('Short sentences. No jargon.');
  });

  it('adds nothing when there is no sample', () => {
    expect(inputsFromProject(project)).not.toHaveProperty('sample_output');
    expect(inputsFromProject({ ...project, sample_output: '   ' })).not.toHaveProperty('sample_output');
  });
});
