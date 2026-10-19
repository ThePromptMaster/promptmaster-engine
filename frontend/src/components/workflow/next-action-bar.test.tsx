import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NextActionBar, blockedReason, type GoControlState } from './next-action-bar';
import type { NextAction } from '@/lib/workflow/next-step';

const apply: NextAction = {
  kind: 'apply_continue',
  label: 'Apply and continue',
  why: 'Realignment, Final review need updating after your change; Go does it and carries on.',
};
const idle: GoControlState = { phase: 'ended', pendingStep: false, authorizing: false, error: null };

describe('the next-step bar never looks pressed for nothing (19 Oct, production)', () => {
  it('is blocked only when Go itself cannot start', () => {
    expect(blockedReason(undefined)).toBeNull();
    expect(blockedReason(idle)).toBeNull();
    expect(blockedReason({ ...idle, phase: 'watching' })).toMatch(/another tab/);
    expect(blockedReason({ ...idle, pendingStep: true })).toMatch(/decision/);
  });

  it('after a failed run, a press shows it is starting Go', async () => {
    const onAct = vi.fn(() => new Promise<void>(() => undefined));
    render(<NextActionBar action={apply} onAct={onAct} go={idle} />);
    await userEvent.click(screen.getByRole('button', { name: /Apply and continue/ }));
    expect(onAct).toHaveBeenCalledWith(apply);
    expect(screen.getByRole('button', { name: /Starting Go/ })).toBeDisabled();
  });

  it("says why it cannot act, and shows Go's error under the button", () => {
    const { rerender } = render(<NextActionBar action={apply} onAct={vi.fn()} go={{ ...idle, phase: 'watching' }} />);
    expect(screen.getByRole('button', { name: /Apply and continue/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/another tab/);
    rerender(<NextActionBar action={apply} onAct={vi.fn()} go={{ ...idle, error: 'Could not start Go mode.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start Go mode.');
  });

  it('a bar that only takes the user somewhere does not claim to start Go', async () => {
    const answer: NextAction = { kind: 'answer_go', label: "Answer Go's question", why: 'Go is waiting for you on the current stage.' };
    render(<NextActionBar action={answer} onAct={vi.fn()} go={idle} />);
    await userEvent.click(screen.getByRole('button', { name: /Answer Go's question/ }));
    expect(screen.queryByText(/Starting Go/)).toBeNull();
  });
});
