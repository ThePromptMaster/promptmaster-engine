/**
 * "Ask me questions" searches the web too (Sean, 22 Oct: "it probably needs
 * to be added to the 'ask me questions' button too").
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GuideInterview } from './guide-interview';

const guideNextQuestion = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { guideNextQuestion: (...a: unknown[]) => guideNextQuestion(...a) },
}));

const FOUND = { url: 'https://claude.com/pricing', title: 'Plans & Pricing', excerpt: 'Pro $20/month' };

describe('GuideInterview with the web', () => {
  it('asks with Web access on, shows what was searched, and hands the sources on', async () => {
    guideNextQuestion
      .mockResolvedValueOnce({
        enough: false,
        question: { id: 'q1', question: 'Which plan fits the budget?', why: '', options: ['Pro', 'Max'], multi: false },
        reason: '',
        web_query: 'Claude Pro price per month',
        web_sources: [FOUND],
      })
      .mockResolvedValueOnce({ enough: true, question: null, reason: 'Enough.' });
    const onDone = vi.fn();
    render(<GuideInterview objective="Pick an AI tool under $60 a month" onDone={onDone} onBack={() => undefined} />);

    await screen.findByText(/Which plan fits the budget/);
    expect(guideNextQuestion.mock.calls[0][0]).toMatchObject({ web_access: 'on', sources: [] });
    expect(screen.getByRole('link', { name: 'Plans & Pricing' })).toHaveAttribute('href', FOUND.url);

    await userEvent.click(screen.getByRole('button', { name: 'Pro' }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // The second call numbers new sources after the first search's.
    expect(guideNextQuestion.mock.calls[1][0].sources).toEqual([FOUND]);
    expect(onDone.mock.calls[0][1]).toEqual([{ query: 'Claude Pro price per month', sources: [FOUND] }]);
  });
});
