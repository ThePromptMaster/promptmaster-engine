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

describe('Apply and continue answers every press (14 Oct call)', () => {
  it('stops saying "Starting Go…" as soon as Go moves on, not eight seconds later', async () => {
    const onAct = vi.fn(() => new Promise<void>(() => undefined));
    const { rerender } = render(<NextActionBar action={apply} onAct={onAct} go={idle} />);
    await userEvent.click(screen.getByRole('button', { name: /Apply and continue/ }));
    expect(screen.getByRole('button', { name: /Starting Go/ })).toBeDisabled();
    // Go started and stopped at once: the phase changed, so the press is answered.
    rerender(<NextActionBar action={apply} onAct={onAct} go={{ ...idle, phase: 'awaiting' }} />);
    expect(screen.getByRole('button', { name: /Apply and continue/ })).toBeEnabled();
  });

  it("offers to show Go's waiting proposal instead of only disabling the button", async () => {
    const onShowGo = vi.fn();
    render(<NextActionBar action={apply} onAct={vi.fn()} go={{ ...idle, pendingStep: true }} onShowGo={onShowGo} />);
    await userEvent.click(screen.getByRole('button', { name: /Show Go's proposal/ }));
    expect(onShowGo).toHaveBeenCalled();
  });
});
