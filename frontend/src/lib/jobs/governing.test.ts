import { describe, expect, it } from 'vitest';

import { GOVERNING_MAX, governingText } from './governing';
import type { StageDefinition } from '@/lib/workflow/types';

const stage = (id: string, renderer: string, label = id.toUpperCase()) => ({ id, label, renderer }) as unknown as StageDefinition;
const stages = [stage('brief', 'prose'), stage('plan', 'prose', 'Core plan'), stage('outline', 'outline'), stage('docs', 'long_form'), stage('check', 'review')];

describe('what a chapter is written against (7 Nov, production)', () => {
  it('holds the earlier prose and list stages, labelled, in stage order', () => {
    expect(governingText(stages, 'docs', { brief: 'The brief.', plan: 'North 4/4.', outline: '{"items":[]}' })).toBe('### BRIEF\nThe brief.\n\n### Core plan\nNorth 4/4.');
  });

  it('never a later stage, a review, or the outline itself', () => {
    expect(governingText(stages, 'plan', { brief: 'The brief.', plan: 'Own text.', check: 'A finding.' })).toBe('### BRIEF\nThe brief.');
  });

  it('gives the room to the nearest stage first and says what it left out', () => {
    const out = governingText(stages, 'docs', { brief: 'b'.repeat(GOVERNING_MAX), plan: 'p'.repeat(GOVERNING_MAX - 1_000) });
    expect(out).toContain('p'.repeat(GOVERNING_MAX - 1_000));
    expect(out).toContain('the rest of this stage is left out');
    expect(out.indexOf('### BRIEF')).toBeLessThan(out.indexOf('### Core plan'));
  });

  it('is empty with nothing written', () => {
    expect(governingText(stages, 'docs', {})).toBe('');
  });
});
