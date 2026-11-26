import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ createClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));

import { recordModelUsage, setUsageOperation, startRunMeter, stopRunMeter, takeOutsideCost, takeStepCost } from './model-usage';

const event = (costUsd: number) => ({ model: 'm', tokensIn: 1, tokensOut: 1, costUsd, promptPriceUsd: null, completionPriceUsd: null, elapsedMs: 1 }) as never;

/**
 * 26 Nov, Sean: "It reads the cost way less than what the piggy bank says." A side-chat
 * message sent while Go was mid-step was charged to Go's step and run.
 */
describe("the side chat's calls while Go works", () => {
  it("are not charged to Go's step or run; Go's own calls are", async () => {
    startRunMeter(0);
    setUsageOperation({ operation: 'go:revise_stage', agentStepId: 'step-9' });
    await recordModelUsage([event(0.4)], { route: '/api/chat-message', requestId: 'r' });
    await recordModelUsage([event(0.1)], { route: '/api/suggest-actions', requestId: 'r' });
    await recordModelUsage([event(1.5)], { route: '/api/generate-stage-artifact', requestId: 'r' });
    setUsageOperation(null);
    expect(takeStepCost('step-9')).toBeCloseTo(1.5, 6);
    expect(takeOutsideCost()).toEqual({ cost: 0, unpriced: 0 });
    stopRunMeter();
  });
});
