import { describe, expect, it } from 'vitest';

import { inForce } from './use-stage-chat';
import type { StageChatMessage } from '@/lib/supabase/conversation';

const m = (id: string, role: 'user' | 'assistant', mode: 'discuss' | 'instruct', extra: Partial<StageChatMessage> = {}): StageChatMessage =>
  ({ id, iteration_number: 1, role, content: id, created_at: '2026-10-18T00:00:00Z', mode, ...extra }) as StageChatMessage;

describe('instructions that never changed the document are not history (18 Oct, production pass)', () => {
  it('keeps the discussion and applied instructions; drops discarded and unapplied ones', () => {
    const thread = [
      m('asked about the budget', 'user', 'discuss'),
      m('the budget is $40,000', 'assistant', 'discuss'),
      m('use the latest facts in Status', 'user', 'instruct', { appliedVersionId: 'v6' }),
      m('Applied to the whole document', 'assistant', 'instruct'),
      m('the November 5 figure was $17,000', 'user', 'instruct', { discarded: true }),
      m('an instruction left unanswered', 'user', 'instruct'),
    ];
    expect(inForce(thread).map((x) => x.id)).toEqual([
      'asked about the budget',
      'the budget is $40,000',
      'use the latest facts in Status',
      'Applied to the whole document',
    ]);
  });
});
