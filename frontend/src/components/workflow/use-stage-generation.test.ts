import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BOOK_V1, projectState } from '@/lib/workflow';
import type { Project } from '@/types/project';

const generateStageArtifact = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: { generateStageArtifact } }));

import { useStageGeneration } from './use-stage-generation';

const project = {
  id: 'p1', user_id: 'u1', objective: 'A book about owls', audience: 'General', constraints: '',
  output_format: '', mode: 'architect', model: '', workflow: 'book', stage: 'objective',
} as unknown as Project;

const objective = BOOK_V1.stages[0];
const audience = BOOK_V1.stages[1];

function setup() {
  let release: (v: unknown) => void = () => undefined;
  generateStageArtifact.mockImplementation(
    (_req: unknown, signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        release = resolve;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
  );
  const state = projectState(BOOK_V1, [], 'objective');
  const append = vi.fn(async () => undefined);
  const hook = renderHook(
    (props: { stageId: string; enabled: boolean; current: string }) =>
      useStageGeneration({
        project,
        template: BOOK_V1,
        state: { ...state, current_stage_id: props.current },
        stage: BOOK_V1.stages.find((s) => s.id === props.stageId),
        bundles: {},
        enabled: props.enabled,
        appendStageVersion: append,
      }),
    { initialProps: { stageId: objective.id, enabled: true, current: objective.id } }
  );
  return { hook, release: (v: unknown) => release(v), append };
}

describe('useStageGeneration: status belongs to the stage it is about (4 Oct)', () => {
  it('shows "drafting" on the stage being drafted, not on a stage being browsed', async () => {
    const { hook } = setup();
    expect(hook.result.current.generating).toBe(true);

    // Browse an earlier/other stage: the cursor has not moved.
    hook.rerender({ stageId: audience.id, enabled: false, current: objective.id });
    expect(hook.result.current.generating).toBe(false);

    // Back on the stage being drafted, it is still drafting — nothing aborted it.
    hook.rerender({ stageId: objective.id, enabled: true, current: objective.id });
    expect(hook.result.current.generating).toBe(true);
    expect(generateStageArtifact).toHaveBeenCalledTimes(1);
  });

  it('a failure shows only on its own stage', async () => {
    generateStageArtifact.mockReset();
    const { hook } = setup();
    generateStageArtifact.mockRejectedValueOnce(new Error('upstream 502'));
    // Re-run via Regenerate so the rejection above is the one used.
    await act(async () => {
      hook.result.current.generate({ force: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.failure).not.toBeNull();
    hook.rerender({ stageId: audience.id, enabled: false, current: objective.id });
    expect(hook.result.current.failure).toBeNull();
  });

  it('a draft abandoned because the workflow moved on is drafted again on return', async () => {
    generateStageArtifact.mockReset();
    const { hook } = setup();
    expect(generateStageArtifact).toHaveBeenCalledTimes(1);

    // The cursor moves to Audience (continue/skip) while Objective drafts.
    await act(async () => {
      hook.rerender({ stageId: audience.id, enabled: true, current: audience.id });
    });
    // Audience starts its own draft; Objective's was aborted.
    expect(generateStageArtifact).toHaveBeenCalledTimes(2);

    // A return to Objective drafts it again rather than opening blank.
    await act(async () => {
      hook.rerender({ stageId: objective.id, enabled: true, current: objective.id });
    });
    expect(generateStageArtifact).toHaveBeenCalledTimes(3);
  });
});
