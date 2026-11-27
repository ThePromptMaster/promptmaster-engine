import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMAIL_OUTREACH_V1 } from '@/lib/workflow/templates/email-outreach.v1';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { Project } from '@/types/project';

import { STALE_SAVE, useOutreachContext } from './use-outreach-context';

const project = { id: 'p1', user_id: 'u1', model: 'm', mode: 'architect' } as unknown as Project;
const draftsStage = EMAIL_OUTREACH_V1.stages.find((s) => s.outreach?.part === 'drafts')!.id;

function bundles(ids: string[]): Record<string, StageArtifactBundle> {
  return { [draftsStage]: { versions: ids.map((id) => ({ id, content: `{"v":"${id}"}` })) } as unknown as StageArtifactBundle };
}

describe('an outreach part saved from a page that is out of date (27 Nov pass)', () => {
  it('is refused when another tab saved since, and saves when the page holds the head', async () => {
    let head = 'v2';
    const appendStageVersion = vi.fn(async () => ({ id: 'v3' }));
    const headOf = vi.fn(async () => head);
    const { result } = renderHook(() => useOutreachContext({ template: EMAIL_OUTREACH_V1, bundles: bundles(['v1', 'v2']), project, appendStageVersion, headOf }));

    // The head is the page's own latest: the save goes ahead, and its version is known after.
    await act(() => result.current!.save(draftsStage, '{}', 'outreach_edit', 'x'));
    expect(appendStageVersion).toHaveBeenCalledTimes(1);
    head = 'v3';
    await act(() => result.current!.save(draftsStage, '{}', 'outreach_edit', 'y'));
    expect(appendStageVersion).toHaveBeenCalledTimes(2);

    // Another tab saved v9: nothing is written, and the page is told to reload.
    head = 'v9';
    await expect(result.current!.save(draftsStage, '{}', 'outreach_edit', 'z')).rejects.toThrow(STALE_SAVE);
    await expect(result.current!.ensureCurrent!(draftsStage)).rejects.toThrow(STALE_SAVE);
    expect(appendStageVersion).toHaveBeenCalledTimes(2);
  });

  it('goes ahead when the head cannot be read, as it did before the check', async () => {
    const appendStageVersion = vi.fn(async () => ({ id: 'v2' }));
    const headOf = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useOutreachContext({ template: EMAIL_OUTREACH_V1, bundles: bundles(['v1']), project, appendStageVersion, headOf }));
    await act(() => result.current!.save(draftsStage, '{}', 'outreach_edit', 'x'));
    expect(appendStageVersion).toHaveBeenCalledTimes(1);
  });
});
