/**
 * 22 Nov, Sean, Migration Week Operating Packet: "Change it → Whole document →
 * Draft revision" failed, the page said nothing was changed, and the box was
 * empty; each press saved his instruction once more. A failed revision keeps the
 * request on offer, and sending it again saves nothing twice (L-276).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveStageChatMessage = vi.fn();
const applyToAnswer = vi.fn();

vi.mock('@/lib/supabase/conversation', () => ({
  loadStageChat: vi.fn(async () => []),
  markStageChatApplied: vi.fn(),
  markStageChatDiscarded: vi.fn(),
  saveStageChatMessage: (...a: unknown[]) => saveStageChatMessage(...a),
}));
vi.mock('@/lib/api/client', async (real) => {
  const actual = await real<typeof import('@/lib/api/client')>();
  return { ...actual, api: { ...actual.api, applyToAnswer: (...a: unknown[]) => applyToAnswer(...a) } };
});

import { ApiError } from '@/lib/api/client';
import { KEPT_FOR_RETRY, useStageChat } from './use-stage-chat';

const project = { id: 'p1', user_id: 'u1', title: 'Migration week', objective: 'An operating packet.', mode: 'architect', facts: [] } as never;
const head = { id: 'v1', artifact_id: 'a1', version_number: 1, content: '# Operating packet\n\nMonday: A, B.' } as never;

describe('a revision that failed is kept to send again (L-276)', () => {
  beforeEach(() => {
    saveStageChatMessage.mockReset().mockImplementation(async (m: { content: string }) => ({ id: 'm1', role: 'user', content: m.content, mode: 'instruct', created_at: '' }));
    applyToAnswer.mockReset();
  });

  it('offers "Try this change again", and the retry reuses the saved message', async () => {
    applyToAnswer.mockRejectedValueOnce(
      new ApiError('PromptMaster ran out of time on this request (about 13 minutes) and stopped. Nothing was changed.', 502, { code: 'out_of_time' })
    );
    const { result } = renderHook(() =>
      useStageChat({ project, stageId: 'packet', stageLabel: 'Operating packet', content: '# Operating packet\n\nMonday: A, B.', headVersion: head })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.propose('OPS-02 replaces the base capacity in OPS-01.', 'document');
    });
    expect(result.current.error).toContain('ran out of time');
    expect(result.current.error).toContain(KEPT_FOR_RETRY);
    expect(result.current.redo).toMatchObject({ instruction: 'OPS-02 replaces the base capacity in OPS-01.', kind: 'document', failed: true, savedId: 'm1' });
    expect(saveStageChatMessage).toHaveBeenCalledTimes(1);

    applyToAnswer.mockRejectedValueOnce(new ApiError('still too long', 502, { code: 'out_of_time' }));
    await act(async () => {
      await result.current.redraft();
    });
    expect(applyToAnswer).toHaveBeenCalledTimes(2);
    // Sent again, not saved again.
    expect(saveStageChatMessage).toHaveBeenCalledTimes(1);
    expect(result.current.redo?.savedId).toBe('m1');
  });
});
