import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoControl } from './go-control';
import type { AgentRun } from '@/types/agent';

function run(over: Partial<AgentRun>): AgentRun {
  return {
    id: 'r1', user_id: 'u', project_id: 'p', policy: 'autonomous', status: 'running', stop_reason: null,
    authorization_id: null, budget_steps: 25, budget_usd: null, steps_used: 14, cost_usd: 0,
    lease_holder: null, heartbeat_at: null, created_at: '2026-10-02T00:00:00Z', ended_at: null,
    needs: null, continues_run_id: null, ...over,
  };
}

function setup(r: AgentRun | null, budget: number) {
  render(
    <GoControl run={r} running={false} budget={budget} onBudget={() => {}} onGo={() => {}} onStop={() => {}}
      canResume={false} disabled={false} />
  );
  return screen.getByLabelText('Step budget') as HTMLSelectElement;
}

describe('GoControl', () => {
  it('shows the live window\'s own size in the selector, whatever was picked since', () => {
    // A 25-step window continued from the card while the selector read 12
    // printed "Window 12 steps" beside "14 / 25 steps this window".
    const select = setup(run({}), 12);
    expect(select.value).toBe('25');
    expect(select).toBeDisabled();
    expect(screen.getByText('14 / 25 steps this window')).toBeInTheDocument();
  });

  it('shows the size of the next window once the run has ended, and says which window each number is about', () => {
    // "12 steps" beside "14 / 25 steps this window" read as a contradiction
    // (2 Oct, screenshot 8). Ended, the selector is the next window and says so.
    const select = setup(run({ status: 'budget_exhausted', steps_used: 25, ended_at: '2026-10-02T01:00:00Z' }), 12);
    expect(select.value).toBe('12');
    expect(select).toBeEnabled();
    expect(screen.getByText('Next window')).toBeInTheDocument();
    expect(screen.getByText('25 of 25 steps used in the last window')).toBeInTheDocument();
  });

  it('explains a step in one sentence', () => {
    setup(run({}), 12);
    expect(screen.getByText('A step is one thing PromptMaster does, like drafting or checking a stage. Running code counts as two.')).toBeInTheDocument();
    expect(screen.queryByText(/credits or tokens/)).toBeNull();
  });
});
