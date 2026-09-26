import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NextMoveCard } from './next-move-card';
import { DecisionPrompt } from './agent/decision-prompt';
import type { AgentStep } from '@/types/agent';

const step = {
  id: 's1', action_key: 'advance_stage', rationale: 'The current issue is stage drift.', expected_outcome: 'Moves on.',
  decision_question: null, started_at: '2026-09-27T10:00:00Z',
} as unknown as AgentStep;

describe('PM-23: a suggested move made before the stage changed', () => {
  it('is offered as usual while it is current', async () => {
    const onDo = vi.fn();
    render(<NextMoveCard step={step} onDo={onDo} onReplan={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Do it' }));
    expect(onDo).toHaveBeenCalled();
  });

  it('says it may be outdated and offers to suggest again instead of doing it', async () => {
    const onDo = vi.fn();
    const onReplan = vi.fn();
    render(<NextMoveCard step={step} stale onDo={onDo} onReplan={onReplan} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Suggested before your latest change');
    expect(screen.queryByRole('button', { name: 'Do it' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Suggest again' }));
    expect(onReplan).toHaveBeenCalled();
    expect(onDo).not.toHaveBeenCalled();
  });

  it('the Go panel says the same about the same step', async () => {
    const onReplan = vi.fn();
    render(<DecisionPrompt step={step} stale onApprove={vi.fn()} onReplan={onReplan} onDecline={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Proposed before your latest change');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Propose again' }));
    expect(onReplan).toHaveBeenCalled();
  });
});
