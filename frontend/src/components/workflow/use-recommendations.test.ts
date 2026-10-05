import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow';
import { serializeItems } from '@/lib/workflow/stage-artifact';
import { useProjectStore } from '@/stores/project-store';
import type { ArtifactVersion, Project } from '@/types/project';

const api = vi.hoisted(() => ({ generateStageArtifact: vi.fn(), applyRecommendations: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/supabase/recommendations', () => ({
  dismissedCategories: () => new Set(),
  insertRecommendation: vi.fn(),
  recordDecision: vi.fn(async () => undefined),
  resolveRecommendation: vi.fn(async (id: string) => ({ id, status: 'accepted' })),
}));
vi.mock('@/lib/supabase/tasks', () => ({ createTask: vi.fn(), setTaskStatus: vi.fn() }));

import { useRecommendations } from './use-recommendations';

const project = {
  id: 'p1', user_id: 'u1', objective: 'A book about owls', audience: 'General', constraints: '',
  output_format: '', mode: 'architect', model: 'm', workflow: 'book', stage: 'audience', status: 'active',
} as unknown as Project;

// A stage whose draft is a table (Book's audience segments).
const stage = BOOK_V1.stages.find((s) => s.renderer === 'list')!;
const table = serializeItems([{ id: 'a', segment: 'Birders' }, { id: 'b', segment: 'Students' }]);
const head = { id: 'v1', content: table } as unknown as ArtifactVersion;

function setup() {
  useProjectStore.setState({
    recommendations: [
      { id: 'r1', status: 'pending', kind: 'correction', category: 'fix-1', title: 'Sharpen segments', summary: 'Sharpen', suggested_change: 'Be specific', instruction: 'Make each segment specific.', rationale: '', scope: { stage_id: stage.id }, version_id: 'v1', tags: [], severity: 'warning' },
    ] as never,
    tasks: [],
    reloadRecommendations: vi.fn(async () => undefined),
  } as never);
  const append = vi.fn(async () => undefined);
  const request = vi.fn((instruction: string) => ({ instruction }) as never);
  const hook = renderHook(() =>
    useRecommendations({
      project, template: BOOK_V1, stage,
      stageEvaluation: { unmet: [], met: [], canAdvance: false } as never,
      headVersion: head, storedEvaluation: undefined,
      modelRecommendation: null, onModelRecommendationConsumed: () => undefined,
      appendStageVersion: append,
      table: { stage, request },
      enabled: true,
    })
  );
  return { hook, append, request };
}

describe('useRecommendations: Apply on a table stage (4 Oct, Options v3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revises the rows through the stage generator, never the prose endpoint', async () => {
    api.generateStageArtifact.mockResolvedValueOnce({
      content: '', items: [{ id: 'a', segment: 'Backyard birders' }, { id: 'b', segment: 'Biology students' }],
      finish_reason: 'stop', model_used: 'm',
    });
    const { hook, append, request } = setup();

    act(() => hook.result.current.openPreview(['fix-1']));
    await act(async () => hook.result.current.confirmApply({ showFirst: true }));

    expect(api.applyRecommendations).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    const saved = (append.mock.calls[0] as unknown[])[2] as { content: string; source_operation: string };
    expect(saved.source_operation).toBe('applied_recommendations');
    expect(saved.content).toContain('Backyard birders');
  });

  it('a revision with no rows saves nothing and says so', async () => {
    api.generateStageArtifact.mockResolvedValueOnce({ content: '', items: [], finish_reason: 'stop', model_used: 'm' });
    const { hook, append } = setup();

    act(() => hook.result.current.openPreview(['fix-1']));
    await act(async () => hook.result.current.confirmApply());

    expect(append).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/Nothing was changed/);
  });
});
