/**
 * "Ask me questions" in the start conversation, beside the outline (Sean,
 * 31 Oct: "put 'ask question' button in conversation part where outline is
 * and take it out of the initial screen").
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FrontDoor, questionsAsked, sourcesFound, type Turn } from './front-door';

const frontDoor = vi.fn();
const guideNextQuestion = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    frontDoor: (...a: unknown[]) => frontDoor(...a),
    guideNextQuestion: (...a: unknown[]) => guideNextQuestion(...a),
  },
}));

const brief = (objective: string, audience = '') => ({ objective, audience, requirements: [], evidence: [], deliverables: [], stages: [], approvals: [] });
const question = (n: number, extra: Record<string, unknown> = {}) => ({
  enough: false,
  question: { id: `q${n}`, question: `Question ${n}?`, why: 'Because it changes the setup.', options: ['Yes', 'No'], multi: false },
  reason: '',
  ...extra,
});
const FOUND = { url: 'https://claude.com/pricing', title: 'Plans & Pricing', excerpt: 'Pro $20/month' };

beforeEach(() => {
  frontDoor.mockReset();
  guideNextQuestion.mockReset();
  frontDoor.mockImplementation(async (req: { turns: { content: string }[] }) => ({
    reply: `Noted: ${req.turns[req.turns.length - 1].content}`,
    brief: brief('A cookbook', req.turns.length > 1 ? 'Family' : ''),
    ready: false,
  }));
});

async function opened() {
  await screen.findByText('Noted: A cookbook');
}

describe('Ask me questions, in the conversation', () => {
  it('asks reading the conversation, puts the answer into it, and asks the next', async () => {
    const user = userEvent.setup();
    guideNextQuestion.mockResolvedValueOnce(question(1, { web_query: 'cookbook formats', web_sources: [FOUND] })).mockResolvedValueOnce(question(2));
    render(<FrontDoor opening="A cookbook" onReady={vi.fn()} onBack={vi.fn()} material="Recipe list" />);
    await opened();

    await user.click(screen.getByRole('button', { name: 'Ask me questions' }));
    expect(await screen.findByText('Question 1?')).toBeInTheDocument();
    const first = guideNextQuestion.mock.calls[0][0];
    expect(first).toMatchObject({ objective: 'A cookbook', answered: [], web_access: 'on', sources: [] });
    expect(first.material).toContain('Recipe list');
    expect(first.material).toContain('PromptMaster: Noted: A cookbook');
    expect(screen.getByRole('link', { name: 'Plans & Pricing' })).toHaveAttribute('href', FOUND.url);

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    // The answer is the user's turn, so the outline takes it in.
    await waitFor(() => expect(frontDoor).toHaveBeenCalledTimes(2));
    // Its reply acknowledges the answer and asks nothing: the card asks next.
    expect(frontDoor.mock.calls[1][0].questions).toBe(true);
    expect(frontDoor.mock.calls[0][0].questions).toBeUndefined();
    expect(frontDoor.mock.calls[1][0].turns.slice(-2)).toEqual([
      { role: 'assistant', content: 'Question 1?' },
      { role: 'user', content: 'Yes' },
    ]);
    expect(await screen.findByText('Question 2?')).toBeInTheDocument();
    const second = guideNextQuestion.mock.calls[1][0];
    expect(second.answered).toEqual([{ question: 'Question 1?', answer: 'Yes' }]);
    expect(second.sources).toEqual([FOUND]);
  });

  it('takes a typed message as the answer to the question waiting', async () => {
    const user = userEvent.setup();
    guideNextQuestion.mockResolvedValueOnce(question(1)).mockResolvedValueOnce({ enough: true, question: null, reason: 'I have what I need.' });
    render(<FrontDoor opening="A cookbook" onReady={vi.fn()} onBack={vi.fn()} />);
    await opened();
    await user.click(screen.getByRole('button', { name: 'Ask me questions' }));
    await screen.findByText('Question 1?');
    await user.type(screen.getByLabelText('Your message'), 'Only vegetarian');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // The end is said plainly, not as the server's restated brief.
    expect(await screen.findByText('That is enough to set this up.')).toBeInTheDocument();
    expect(screen.queryByText('I have what I need.')).toBeNull();
    expect(guideNextQuestion.mock.calls[1][0].answered).toEqual([{ question: 'Question 1?', answer: 'Only vegetarian' }]);
    // Asking is over: the button is back.
    expect(screen.getByRole('button', { name: 'Ask me questions' })).toBeInTheDocument();
  });

  it('stops at the Simple cap without another call, with the reason folded', async () => {
    const user = userEvent.setup();
    guideNextQuestion.mockImplementation(async (req: { answered: unknown[] }) => question(req.answered.length + 1));
    render(<FrontDoor opening="A cookbook" onReady={vi.fn()} onBack={vi.fn()} maxQuestions={2} foldWhy />);
    await opened();
    await user.click(screen.getByRole('button', { name: 'Ask me questions' }));
    expect(await screen.findByText('Question 1 of up to 2')).toBeInTheDocument();
    expect(guideNextQuestion.mock.calls[0][0]).toMatchObject({ max_questions: 2 });
    expect(screen.queryByText('Because it changes the setup.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Why this question?' }));
    expect(screen.getByText('Because it changes the setup.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(await screen.findByText('Question 2 of up to 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip this one' }));
    expect(await screen.findByText('That is enough to set this up.')).toBeInTheDocument();
    expect(guideNextQuestion).toHaveBeenCalledTimes(2);
  });

  it('stops when asked to, and the question stays in the conversation', async () => {
    const user = userEvent.setup();
    guideNextQuestion.mockResolvedValueOnce(question(1));
    render(<FrontDoor opening="A cookbook" onReady={vi.fn()} onBack={vi.fn()} />);
    await opened();
    await user.click(screen.getByRole('button', { name: 'Ask me questions' }));
    await screen.findByText('Question 1?');
    await user.click(screen.getAllByRole('button', { name: "That's enough questions" })[0]);
    expect(screen.queryByRole('button', { name: 'Next question' })).toBeNull();
    expect(screen.getByText('Question 1?')).toBeInTheDocument();
    expect(guideNextQuestion).toHaveBeenCalledTimes(1);
  });
});

describe('questionsAsked', () => {
  it('pairs each question with the answer after it, empty when skipped', () => {
    const q = (id: string) => ({ id, question: id, why: '', options: [] });
    const turns: Turn[] = [
      { role: 'user', content: 'A cookbook' },
      { role: 'assistant', content: 'a', question: q('a') },
      { role: 'user', content: 'Yes' },
      { role: 'assistant', content: 'ok', web: { query: 'x', sources: [FOUND] } },
      { role: 'assistant', content: 'b', question: q('b'), skipped: true },
      { role: 'assistant', content: 'c', question: q('c') },
    ];
    expect(questionsAsked(turns)).toEqual([
      { question: 'a', answer: 'Yes' },
      { question: 'b', answer: '' },
      { question: 'c', answer: '' },
    ]);
    expect(sourcesFound(turns)).toEqual([FOUND]);
  });
});
