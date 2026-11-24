import { describe, expect, it } from 'vitest';

import { needStillHolds } from '@/lib/agent/needs';

/**
 * A stop on a folder rule and a note (L-280, 24 Nov pass): the need names the conflict, and
 * holds like any question until the run is resumed after the user chooses on the card.
 */
describe('the stop on a folder choice', () => {
  it('holds as a question until the run is resumed', () => {
    const need = { kind: 'answer_question' as const, question: 'Report notes waits on your choice', folderChoice: 'c1', onStage: 'report' };
    expect(needStillHolds(need as never, { currentStageId: 'report', state: { stages: {}, current_stage_id: 'report' } } as never)).toBe(true);
  });
});
