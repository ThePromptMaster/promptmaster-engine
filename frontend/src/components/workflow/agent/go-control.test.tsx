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

describe('GoControl, pinned copy', () => {
  function pinned(over: Partial<{ canResume: boolean; hideResume: boolean }>, r: AgentRun) {
    render(
      <GoControl run={r} running={false} budget={25} onBudget={() => {}} onGo={() => {}} onStop={() => {}}
        canResume={over.canResume ?? false} hideResume={over.hideResume} disabled={false} compact />
    );
  }

  it('keeps to one row: no explanation, and Resume says what it does as its tooltip', () => {
    // 25 Oct (Sean, iPad): the sentence beside the dock's buttons wrapped one word per line.
    pinned({ canResume: true }, run({ status: 'awaiting_decision' }));
    expect(screen.queryByText(/Resume carries on this run/)).toBeNull();
    expect(screen.queryByText(/A step is one thing/)).toBeNull();
    expect(screen.getByRole('button', { name: /Resume/ })).toHaveAttribute('title', expect.stringMatching(/Resume carries on this run/));
  });

  it('leaves a live window\'s locked size to the panel', () => {
    pinned({}, run({}));
    expect(screen.queryByLabelText('Step budget')).toBeNull();
    expect(screen.getByText('14 / 25 steps this window')).toBeInTheDocument();
  });
});

describe('GoControl, Resume hidden', () => {
  it('does not explain a Resume button that is not there', () => {
    render(
      <GoControl run={run({ status: 'blocked' })} running={false} budget={25} onBudget={() => {}} onGo={() => {}} onStop={() => {}}
        canResume hideResume disabled={false} />
    );
    expect(screen.queryByText(/Resume carries on this run/)).toBeNull();
  });
});
