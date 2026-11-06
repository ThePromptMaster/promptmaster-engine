import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { takeStartGoal } from '@/lib/projects/example-goals';

import { ExampleQuestionnaire } from './example-questionnaire';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let user: { id: string } | null = null;
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user }) }));

const loadAnswers = vi.fn(async (): Promise<unknown> => null);
const saveAnswers = vi.fn(async () => {});
vi.mock('@/lib/supabase/preferences', () => ({
  loadAnswers: (...args: unknown[]) => (loadAnswers as (...a: unknown[]) => Promise<unknown>)(...args),
  saveAnswers: (...args: unknown[]) => (saveAnswers as (...a: unknown[]) => Promise<void>)(...args),
}));

describe('the questionnaire', () => {
  beforeEach(() => {
    user = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('stays folded until asked for', async () => {
    render(<ExampleQuestionnaire />);
    expect(screen.queryByRole('region')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Not sure which? Three quick questions' }));
    expect(screen.getByRole('region', { name: 'Three quick questions' })).toBeInTheDocument();
  });

  it('suggests one from the taps, asks no model, and needs no account', async () => {
    const ui = userEvent.setup();
    render(<ExampleQuestionnaire />);
    await ui.click(screen.getByRole('button', { name: /Three quick questions/ }));
    expect(screen.queryByText('Start here')).toBeNull();
    await ui.click(screen.getByRole('button', { name: 'Consulting or strategy' }));
    await ui.click(screen.getByRole('button', { name: 'Slides' }));
    expect(screen.getByRole('link', { name: /Start here\s*Slide deck/ })).toHaveAttribute('href', '/examples/slide-deck');
    expect(saveAnswers).not.toHaveBeenCalled();
  });

  it('remembers the taps for a signed-in user, and only the taps', async () => {
    user = { id: 'u1' };
    const ui = userEvent.setup();
    render(<ExampleQuestionnaire />);
    await ui.click(screen.getByRole('button', { name: /Three quick questions/ }));
    await ui.click(screen.getByRole('button', { name: 'Investing or deals' }));
    await ui.type(screen.getByLabelText(/on your plate/), 'A memo on a logistics deal');
    expect(saveAnswers).toHaveBeenCalledTimes(1);
    expect(saveAnswers).toHaveBeenCalledWith('u1', { work: 'investing', need: undefined });
  });

  it('picks up earlier answers', async () => {
    user = { id: 'u1' };
    loadAnswers.mockResolvedValueOnce({ need: 'slides' });
    const ui = userEvent.setup();
    render(<ExampleQuestionnaire />);
    await waitFor(() => expect(loadAnswers).toHaveBeenCalledWith('u1'));
    await ui.click(screen.getByRole('button', { name: /Three quick questions/ }));
    expect(screen.getByRole('button', { name: 'Slides' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('carries what they typed to the start box, not through the URL', async () => {
    const ui = userEvent.setup();
    render(<ExampleQuestionnaire />);
    await ui.click(screen.getByRole('button', { name: /Three quick questions/ }));
    await ui.type(screen.getByLabelText(/on your plate/), 'Board deck for Thursday');
    await ui.click(screen.getByRole('button', { name: 'Start from this' }));
    expect(push).toHaveBeenCalledWith('/projects/new');
    expect(takeStartGoal()).toBe('Board deck for Thursday');
    expect(takeStartGoal()).toBe('');
  });
});
