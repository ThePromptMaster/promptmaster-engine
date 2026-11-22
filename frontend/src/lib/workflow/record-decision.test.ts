import { describe, expect, it, vi } from 'vitest';

import { dbError } from '@/lib/supabase/errors';
import { writeDecision } from './record-decision';

const decision = { criterionId: 'approver_decision.approved', stageId: 'approver_decision', choice: 'Approve Option B at $60,000', eventReason: 'Your decision: Approve Option B at $60,000', since: Date.parse('2026-11-22T00:28:30Z') };
const timeout = () => dbError({ message: '<!DOCTYPE html>522' }, 522);
const ourFact = { source_ref: { criterion_id: decision.criterionId, choice: decision.choice }, retired_at: null, created_at: '2026-11-22T00:28:41Z' };

describe('a decision that does not save says why and tries again (L-271, 21 Nov, Sean, scanner)', () => {
  it('a 522 on the fact insert is written once more, then the tick and the event', async () => {
    const order: string[] = [];
    const writeFact = vi.fn().mockRejectedValueOnce(timeout()).mockImplementationOnce(async () => order.push('fact'));
    await writeDecision(decision, {
      writeFact, readFacts: async () => [], pauseMs: 0,
      afterFact: async () => order.push('tick'), writeEvent: async () => order.push('event'), readEvents: async () => [],
      report: vi.fn(),
    });
    expect(writeFact).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['fact', 'tick', 'event']);
  });

  it('a timeout after the fact landed is not written twice', async () => {
    const writeFact = vi.fn().mockRejectedValueOnce(timeout());
    await writeDecision(decision, { writeFact, readFacts: async () => [ourFact], pauseMs: 0, report: vi.fn() });
    expect(writeFact).toHaveBeenCalledTimes(1);
  });

  it('two failures are logged and said, with nothing ticked', async () => {
    const report = vi.fn();
    const afterFact = vi.fn();
    await expect(
      writeDecision(decision, { writeFact: vi.fn().mockRejectedValue(timeout()), readFacts: async () => [], pauseMs: 0, afterFact, report })
    ).rejects.toThrow('Your decision was not recorded: The database did not answer in time (522). Nothing was changed. Press it again.');
    expect(report).toHaveBeenCalledWith('decision_not_recorded', expect.objectContaining({ status: 522 }));
    expect(afterFact).not.toHaveBeenCalled();
  });

  it('an event written but not re-read counts as written', async () => {
    const recorded = Object.assign(new Error('Recorded, but the page could not catch up.'), { name: 'EventRecordedError' });
    await expect(
      writeDecision(decision, { writeFact: async () => undefined, readFacts: async () => [], writeEvent: async () => { throw recorded; }, report: vi.fn(), pauseMs: 0 })
    ).resolves.toBeUndefined();
  });
});
