import { describe, expect, it } from 'vitest';

import { asHistory } from './use-stage-chat';
import type { StageChatMessage } from '@/lib/supabase/conversation';

const m = (iteration_number: number): StageChatMessage =>
  ({ id: `m${iteration_number}`, iteration_number, role: 'assistant', content: 'carried over', created_at: '2026-10-22T00:00:00Z', mode: 'discuss' }) as StageChatMessage;

describe('the thread sent with a question (22 Oct, client: "iteration_number is below the minimum of 1")', () => {
  it('sends the conversation carried over from the start screen, stored as 0, as iteration 1', () => {
    expect(asHistory([m(0), m(3)]).map((x) => x.iteration_number)).toEqual([1, 3]);
  });

  it('sends role and content and nothing else', () => {
    expect(Object.keys(asHistory([m(2)])[0]).sort()).toEqual(['content', 'created_at', 'id', 'iteration_number', 'role']);
  });
});
