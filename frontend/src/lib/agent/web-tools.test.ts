import { describe, expect, it } from 'vitest';
import { allowedActions, toolsFor } from './policy';
import { deriveExecutionLabel } from './labels';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';
import { initialState } from '@/lib/workflow/engine';
import { currentSources, sourcesForRequest } from '@/lib/workflow/sources';
import type { ProjectSource } from '@/types/project';

// 20 Oct (Sean: "web search … On and off button?"): Go may search only while the switch is on.
describe('search_web follows the project switch', () => {
  const state = initialState(SINGLE_OUTPUT_V1);
  const stage = SINGLE_OUTPUT_V1.stages.find((s) => s.renderer === 'prose')!;

  it('is not offered while Web access is off, or unset', () => {
    expect(allowedActions(SINGLE_OUTPUT_V1, state, stage, false, toolsFor({ web_access: 'off' }))).not.toContain('search_web');
    expect(allowedActions(SINGLE_OUTPUT_V1, state, stage, false, toolsFor({}))).not.toContain('search_web');
  });

  it('is offered on a stage that writes once it is on, and labelled as analysis, not a draft', () => {
    expect(toolsFor({ web_access: 'on' })).toMatchObject({ literature: true, web: true });
    expect(allowedActions(SINGLE_OUTPUT_V1, state, stage, false, toolsFor({ web_access: 'on' }))).toContain('search_web');
    expect(deriveExecutionLabel('search_web', { status: 'succeeded', changes: {}, toolsUsed: ['web'], output: '' } as never)).toBe('discussed');
  });
});

describe('saved sources in a request', () => {
  const row = (id: string, retired = false): ProjectSource => ({
    id, seq: 0, project_id: 'p', user_id: 'u', url: `https://example.org/${id}`, title: `Title ${id}`, excerpt: 'x', query: 'q',
    stage_id: null, provider: 'openrouter_web', origin: 'user', agent_run_id: null,
    retrieved_at: '2026-10-20T10:00:00Z', retired_at: retired ? '2026-10-20T11:00:00Z' : null, created_at: '2026-10-20T10:00:00Z',
  });

  it('sends the current ones, oldest first, with the date retrieved; a retired one is not cited', () => {
    expect(currentSources([row('a'), row('b', true), row('c')]).map((s) => s.id)).toEqual(['a', 'c']);
    expect(sourcesForRequest([row('a')])).toEqual([{ url: 'https://example.org/a', title: 'Title a', excerpt: 'x', retrieved: '2026-10-20' }]);
  });
});
