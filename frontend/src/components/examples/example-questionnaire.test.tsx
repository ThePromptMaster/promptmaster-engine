import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { takeStartGoal } from '@/lib/projects/example-goals';

import { ExampleQuestionnaire } from './example-questionnaire';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let user: { id: string } | null = null;
const continueAsGuest = vi.fn(async () => {});
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user, continueAsGuest }) }));

const suggestWorkflows = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { suggestWorkflows: (...args: unknown[]) => suggestWorkflows(...args) } }));

const setRequestLanguage = vi.fn();
vi.mock('@/lib/api/language', () => ({ setRequestLanguage: (code: string) => setRequestLanguage(code) }));

const goSignedIn = vi.fn();
vi.mock('@/lib/auth/sign-in', () => ({ goSignedIn: (to: string) => goSignedIn(to) }));

const ONE_SUGGESTION = {
  work_summary: 'A board update.',
  suggestions: [{ example_key: 'slide_deck', title: 'Board deck for Friday', why: 'You said it is due Friday.', objective: 'I need a board deck for Friday.', based_on: [1] }],
  model_used: 'm',
};

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

  describe('suggesting work', () => {
    async function open(ui: ReturnType<typeof userEvent.setup>) {
      render(<ExampleQuestionnaire />);
      await ui.click(screen.getByRole('button', { name: /Three quick questions/ }));
    }

    it('sends nothing until pressed, and then only what they shared', async () => {
      user = { id: 'u1' };
      suggestWorkflows.mockResolvedValue(ONE_SUGGESTION);
      const ui = userEvent.setup();
      await open(ui);
      expect(screen.queryByRole('button', { name: 'Suggest work for me' })).toBeNull();
      await ui.click(screen.getByRole('button', { name: 'Consulting or strategy' }));
      await ui.type(screen.getByLabelText(/on your plate/), 'A board deck by Friday');
      expect(suggestWorkflows).not.toHaveBeenCalled();
      await ui.click(screen.getByRole('button', { name: 'Suggest work for me' }));

      expect(suggestWorkflows).toHaveBeenCalledTimes(1);
      const sent = suggestWorkflows.mock.calls[0][0];
      expect(sent.items).toEqual([{ kind: 'note', title: 'What they said', text: 'A board deck by Friday' }]);
      expect(sent.profile).toEqual({ work: 'consulting' });
      expect(sent.catalog.map((c: { key: string }) => c.key)).toContain('slide_deck');
      expect(continueAsGuest).not.toHaveBeenCalled();
      expect(await screen.findByText('Board deck for Friday')).toBeInTheDocument();
      // Set for the call, and cleared after it.
      expect(setRequestLanguage).toHaveBeenCalledTimes(2);
      expect(setRequestLanguage).toHaveBeenLastCalledWith('en');
      expect(screen.getByRole('link', { name: 'See the example first' })).toHaveAttribute('href', '/examples/slide-deck');
    });

    it('takes a suggestion to the start box', async () => {
      user = { id: 'u1' };
      suggestWorkflows.mockResolvedValue(ONE_SUGGESTION);
      const ui = userEvent.setup();
      await open(ui);
      await ui.type(screen.getByLabelText(/on your plate/), 'A deck');
      await ui.click(screen.getByRole('button', { name: 'Suggest work for me' }));
      await ui.click(await screen.findByRole('button', { name: 'Start this' }));
      expect(takeStartGoal()).toBe('I need a board deck for Friday.');
      expect(goSignedIn).toHaveBeenCalledWith('/projects/new');
    });

    it('starts a guest for a signed-out visitor first', async () => {
      suggestWorkflows.mockResolvedValue(ONE_SUGGESTION);
      const ui = userEvent.setup();
      await open(ui);
      await ui.type(screen.getByLabelText(/on your plate/), 'A deck');
      await ui.click(screen.getByRole('button', { name: 'Suggest work for me' }));
      await screen.findByText('Board deck for Friday');
      expect(continueAsGuest).toHaveBeenCalledTimes(1);
    });

    it('says so when there is nothing to suggest, or the call fails', async () => {
      user = { id: 'u1' };
      suggestWorkflows.mockResolvedValueOnce({ work_summary: '', suggestions: [], model_used: 'm' });
      const ui = userEvent.setup();
      await open(ui);
      await ui.type(screen.getByLabelText(/on your plate/), 'Hello');
      await ui.click(screen.getByRole('button', { name: 'Suggest work for me' }));
      expect(await screen.findByText(/Nothing clear to suggest/)).toBeInTheDocument();

      suggestWorkflows.mockRejectedValueOnce(new Error('The model is busy'));
      await ui.click(screen.getByRole('button', { name: 'Suggest work for me' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not suggest anything just now: The model is busy');
    });
  });
});
