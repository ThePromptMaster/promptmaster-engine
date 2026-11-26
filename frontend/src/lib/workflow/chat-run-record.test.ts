import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLatestAgentRun = vi.fn();
const listAgentSteps = vi.fn();
const listChainSteps = vi.fn();
const earlierWindowsCost = vi.fn();
vi.mock('@/lib/supabase/agent', () => ({
  getLatestAgentRun: (...a: unknown[]) => getLatestAgentRun(...a),
  listAgentSteps: (...a: unknown[]) => listAgentSteps(...a),
  listChainSteps: (...a: unknown[]) => listChainSteps(...a),
  earlierWindowsCost: (...a: unknown[]) => earlierWindowsCost(...a),
}));

import { runRecordTrace, withProjectCost, withRunRecord } from './chat-run-record';
import type { ChatContext } from '@/types';

/** 5 Nov (a research project): the chat told the client nothing had been run, then that Go was still running. */
const NOW = Date.parse('2026-11-05T01:30:00Z');
const run = { id: 'r1', status: 'blocked', policy: 'autonomous', stop_reason: 'Stopped.', cost_usd: '12.16', created_at: '2026-11-05T00:47:57Z', heartbeat_at: null, needs: null } as never;
const step = (over: object) => ({ action_key: 'evaluate_stage', status: 'succeeded', execution_label: null, output: 'Checked.', started_at: '2026-11-05T01:12:17Z', finished_at: '2026-11-05T01:13:00Z', ...over }) as never;
const context = { go_run: null, stage_label: 'Derivations' } as unknown as ChatContext;

beforeEach(() => {
  getLatestAgentRun.mockReset();
  listAgentSteps.mockReset();
  listChainSteps.mockReset();
  listChainSteps.mockResolvedValue([]);
  earlierWindowsCost.mockReset();
  earlierWindowsCost.mockResolvedValue(0);
});

describe('the run as the chat is told it', () => {
  it('comes from the record, though the tab has loaded nothing', async () => {
    getLatestAgentRun.mockResolvedValue(run);
    listAgentSteps.mockResolvedValue([step({}), step({ action_key: 'run_computation', execution_label: 'Calculated' })]);
    const out = await withRunRecord(context, 'p', NOW);
    expect(out.go_run).toMatchObject({ status: 'blocked', from_record: true, moves: 2, cost_usd: 12.16, last_activity_minutes: 17 });
    expect(out.go_run?.steps.at(-1)).toMatchObject({ action: 'run_computation', execution_label: 'Calculated' });
    expect(out.go_run_read).toBe(true);
  });

  it('counts the windows before this one, and does not count the user\'s answers as moves', async () => {
    getLatestAgentRun.mockResolvedValue(run);
    listChainSteps.mockResolvedValue([step({}), step({ action_key: 'user_answer', output: 'Yes' })]);
    listAgentSteps.mockResolvedValue([step({})]);
    expect((await withRunRecord(context, 'p', NOW)).go_run?.moves).toBe(2);
  });

  it('counts the cost of those windows too, so the moves and the cost cover the same work', async () => {
    getLatestAgentRun.mockResolvedValue(Object.assign({}, run, { cost_usd: '1.01' }));
    listChainSteps.mockResolvedValue([step({}), step({})]);
    listAgentSteps.mockResolvedValue([step({})]);
    earlierWindowsCost.mockResolvedValue(2.34);
    const out = await withRunRecord(context, 'p', NOW);
    expect(out.go_run?.moves).toBe(3);
    expect(out.go_run?.cost_usd).toBeCloseTo(3.35);
  });

  it('says there has been no run only when the record says so', async () => {
    getLatestAgentRun.mockResolvedValue(null);
    expect(await withRunRecord(context, 'p', NOW)).toMatchObject({ go_run: null, go_run_read: true });
  });

  it('a failed read keeps what the tab knew, and with nothing says it could not read', async () => {
    getLatestAgentRun.mockRejectedValue(new Error('down'));
    expect(await withRunRecord(context, 'p', NOW)).toMatchObject({ go_run: null, go_run_read: false });
    const known = { ...context, go_run: { status: 'running', policy: '', stop_reason: '', steps: [], objective: '' } } as ChatContext;
    expect((await withRunRecord(known, 'p', NOW)).go_run?.status).toBe('running');
  });

  // 26 Nov, Sean: "The side chat doesn't appear to keep up with the progress of the workspace."
  it('sends the step still running as running, with how long, and keeps the objective line the page built', () => {
    const trace = runRecordTrace(run, [step({}), step({ status: 'running', output: '', started_at: '2026-11-05T01:21:00Z' })], 'not met', NOW);
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[1]).toMatchObject({ status: 'running', running_minutes: 9 });
    expect(trace.objective).toBe('not met');
  });

  it('reads each step as the live trace does: 1,200 characters and the stage it worked on', () => {
    const long = 'x'.repeat(1_500);
    const names = (id: string) => ({ chapters: 'Chapters', review: 'Review' } as Record<string, string>)[id];
    const trace = runRecordTrace(run, [step({ output: long, stage_id: 'review', params: { stage_id: 'chapters' } })], '', NOW, names);
    expect(trace.steps[0].output).toHaveLength(1_200);
    expect(trace.steps[0].stage).toBe('Chapters');
  });

  it("keeps what the tab driving Go says it is doing now, while the run is running", async () => {
    getLatestAgentRun.mockResolvedValue(Object.assign({}, run, { status: 'running' }));
    listAgentSteps.mockResolvedValue([step({})]);
    const live = { ...context, go_run: { status: 'running', policy: '', stop_reason: '', steps: [], objective: '', progress: '4 of 12 sections written', current_stage: 'Chapters' } } as ChatContext;
    expect((await withRunRecord(live, 'p', NOW)).go_run).toMatchObject({ from_record: true, progress: '4 of 12 sections written', current_stage: 'Chapters' });
  });
});

// 26 Nov, Sean: "It reads the cost way less than what the piggy bank says." The chat was given one run's cost.
describe("the project's cost as the chat is told it", () => {
  it('carries the piggy bank\'s own figure, its calls and the unpriced ones', () => {
    expect(withProjectCost(context, { cost: 41.27, calls: 812, unpriced: 3 }).project_cost).toEqual({ usd: 41.27, calls: 812, unpriced: 3 });
  });

  it('an unreadable total is sent as unknown, never as zero', () => {
    expect(withProjectCost(context, null).project_cost).toBeNull();
    expect(withProjectCost(context, { cost: null, calls: 2, unpriced: 2 }).project_cost).toEqual({ usd: null, calls: 2, unpriced: 2 });
  });
});
