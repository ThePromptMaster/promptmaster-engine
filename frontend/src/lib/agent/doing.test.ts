/**
 * 4 Nov (Sean): "show progress in plain language, such as 'Updating the
 * budget' or 'Checking the revised draft'"; the run meter that the call
 * ceiling and the run's cost read.
 */
import { describe, expect, it } from 'vitest';

import { doingNow, stepTarget } from './doing';
import { runMeterCalls, startRunMeter, takeOutsideCost, recordModelUsage, setUsageOperation } from '@/lib/supabase/model-usage';
import type { AgentStep } from '@/types/agent';

const step = (action_key: string, params: Record<string, unknown> = {}, status: AgentStep['status'] = 'running') =>
  ({ action_key, stage_id: 'final', params, status }) as unknown as AgentStep;
const name = (id: string) => ({ final: 'Final memo', figures: 'Facts and calculations' })[id] ?? id;

describe('what Go is doing, in plain words', () => {
  it('names the action and the stage it works on', () => {
    expect(doingNow(step('evaluate_stage'), name)).toBe('Checking Final memo…');
    expect(doingNow(step('recheck_stage', { stage_id: 'figures' }), name)).toBe('Updating Facts and calculations after the change…');
    expect(doingNow(step('apply_findings'), name)).toBe("Applying the check's findings to Final memo…");
    expect(stepTarget(step('recheck_stage', { stage_id: 'figures' }))).toBe('figures');
  });

  it('says it is choosing the next step, adds a job\'s own count, and is silent when nothing runs', () => {
    expect(doingNow(null, name, { thinking: true })).toBe('Choosing the next step…');
    expect(doingNow(step('draft_sections'), name, { progress: '3 of 8 sections written' })).toBe('Writing the chapters… (3 of 8 sections written)');
    expect(doingNow(step('evaluate_stage', {}, 'succeeded'), name)).toBeNull();
    expect(doingNow(step('some_new_action'), name)).toBe('Working on Final memo…');
  });
});

describe('the run meter (4 Nov)', () => {
  const event = (cost: number | null) => ({ model: 'm', tokensIn: 1, tokensOut: 1, costUsd: cost, promptPriceUsd: null, completionPriceUsd: null, elapsedMs: 1 });

  it('counts every call, priced or not, and keeps the cost of calls outside any step', async () => {
    startRunMeter(0);
    setUsageOperation({ operation: 'go:plan' });
    await recordModelUsage([event(0.01), event(null)] as never, { route: '/api/agent/next-action', requestId: 'r1', projectId: null });
    setUsageOperation({ operation: 'go:evaluate_stage', agentStepId: 's1' });
    await recordModelUsage([event(0.05)] as never, { route: '/api/evaluate-stage-artifact', requestId: 'r2', projectId: null });
    setUsageOperation(null);
    expect(runMeterCalls()).toBe(3);
    expect(takeOutsideCost()).toEqual({ cost: 0.01, unpriced: 1 });
    expect(takeOutsideCost()).toEqual({ cost: 0, unpriced: 0 });
  });
});
