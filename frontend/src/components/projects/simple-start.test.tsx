/**
 * The simple start (Sean, 18 Oct, email 7): a beta user found the start
 * overwhelming — too many questions, too much to read, and no telling whether
 * PromptMaster would do the work or hand him a prompt for ChatGPT.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SetupCard, DOES_THE_WORK, type SetupDraft } from './setup-card';
import { GuideInterview } from './guide-interview';
import type { WorkflowTemplate } from '@/lib/workflow/types';

const guideNextQuestion = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { guideNextQuestion: (...a: unknown[]) => guideNextQuestion(...a) },
}));

const TEMPLATES = [
  { id: 't-so', key: 'single_output', name: 'Single output', description: 'x', version: 5, outline_stage: 'none', stages: [] },
  { id: 't-book', key: 'book', name: 'Book', description: 'y', version: 9, outline_stage: 'explicit', stages: [] },
] as unknown as (WorkflowTemplate & { id: string })[];

const DRAFT: SetupDraft = {
  title: 'Cookbook',
  objective: 'A cookbook of my family recipes, one page each',
  audience: 'General',
  constraints: 'Use only recipes the user supplies',
  output_format: '',
  context: '',
  mode: 'clarity',
};

function card(simple: boolean) {
  return render(
    <SetupCard
      simple={simple}
      start={<button>Start Single output</button>}
      templates={TEMPLATES}
      templateId="t-so"
      onSelectTemplate={() => undefined}
      workflowReason="One finished document."
      recommendedKey="single_output"
      draft={DRAFT}
      rationale={{ mode: '', audience: '', constraints: 'Follows from what you said', output_format: '' }}
      onChange={() => undefined}
    />
  );
}

describe('SetupCard, simple', () => {
  it('shows what you will get and Start, with everything else folded under More options', () => {
    const { container } = card(true);
    expect(screen.getByRole('region', { name: 'What you will get' })).toHaveTextContent('Single output');
    expect(screen.getByRole('region', { name: 'What you will get' })).toHaveTextContent(DRAFT.objective);
    expect(screen.getByRole('button', { name: 'Start Single output' })).toBeVisible();
    expect(screen.getByText(new RegExp(DOES_THE_WORK.replace(/[.;]/g, '.')))).toBeInTheDocument();
    const more = container.querySelector('details[data-more-options]') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more).toHaveTextContent('How PromptMaster should think');
    // Suggested constraints are still pointed out: they become requirements on Start (10 Oct).
    expect(screen.getByText(/suggested some constraints you did not say/)).toBeInTheDocument();
  });

  it('advanced is the full setup, unchanged', () => {
    const { container } = card(false);
    expect(container.querySelector('details[data-more-options]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'What you will get' })).toBeNull();
    expect(screen.getByLabelText('How PromptMaster should think')).toBeVisible();
  });
});

describe('GuideInterview, capped', () => {
  beforeEach(() => guideNextQuestion.mockReset());

  it('asks at most the cap, folds the reason, and stops without another call', async () => {
    const user = userEvent.setup();
    guideNextQuestion.mockImplementation(async (req?: { answered: unknown[] }) => ({
      enough: false,
      question: { id: `q${(req?.answered.length ?? 0) + 1}`, question: `Question ${(req?.answered.length ?? 0) + 1}?`, why: 'Because it changes the setup.', options: ['Yes', 'No'], multi: false },
      reason: '',
    }));
    const onDone = vi.fn();
    render(<GuideInterview objective="A cookbook" maxQuestions={2} foldWhy onDone={onDone} onBack={() => undefined} />);

    expect(await screen.findByText('Question 1 of up to 2')).toBeInTheDocument();
    expect(guideNextQuestion.mock.calls[0][0]).toMatchObject({ max_questions: 2 });
    expect(screen.queryByText('Because it changes the setup.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Why this question?' }));
    expect(screen.getByText('Because it changes the setup.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(await screen.findByText('Question 2 of up to 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // Two questions asked; the cap needs no third call.
    expect(guideNextQuestion.mock.calls.filter(([req]) => req)).toHaveLength(2);
    expect(onDone.mock.calls[0][0]).toHaveLength(2);
  });
});
