import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DecisionChoices } from './decision-options';
import { QuestionPrompt } from './decision-prompt';
import { ChoiceRefused } from '@/lib/workflow/decision-options';

// 22 Nov, Sean's warehouse test: Approve option v6 after Option A's quote rose (L-274).
const CAP = 'Hard cap of $50,000 all-in, including a mandatory $5,000 contingency.';
const A = {
  label: 'Option A: $52,000 all-in, live December 17 (over the $50,000 cap)', quote: '$52,000 ($36,000 + $11,000 + $5,000)',
  fails: { requirement: CAP, quote: 'Ineligible: $2,000 over the cap ($52,000 − $50,000)' },
};
const B = { label: 'Option B: $49,000 all-in, live December 18', quote: '$49,000 ($38,000 + $6,000 + $5,000)' };

describe('an option over a requirement is explained, not offered (L-274)', () => {
  it('A is no button and says which requirement and why; B is a button', () => {
    const onChoose = vi.fn();
    render(<DecisionChoices offer={{ question: 'Which option?', options: [A, B], loading: false }} onChoose={onChoose} recordLabel="Record my decision" />);
    expect(screen.queryByRole('button', { name: A.label })).toBeNull();
    const why = document.querySelector('[data-option-fails]')!;
    expect(why.textContent).toContain(A.label);
    expect(why.textContent).toContain(`breaks your requirement “${CAP.replace(/\.$/, '')}”`);
    expect(why.textContent).not.toContain('.”.');
    expect(why.textContent).toContain('Ineligible: $2,000 over the cap');
    expect(why.textContent).toContain('change that requirement in Facts first');
    fireEvent.click(screen.getByRole('button', { name: B.label }));
    expect(onChoose).toHaveBeenCalledWith(B.label);
  });

  it('typed, the failing option is refused with the reason, and nothing is recorded', () => {
    const onChoose = vi.fn();
    render(<DecisionChoices offer={{ question: '', options: [A, B], loading: false }} onChoose={onChoose} recordLabel="Record my decision" />);
    fireEvent.change(document.querySelector('[data-decision-other]')!, { target: { value: 'Approve Option A anyway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record my decision' }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-decision-refused]')!.textContent).toContain('Nothing was recorded');
  });

  it('when every option fails, it says so instead of "Choose one"', () => {
    render(<DecisionChoices offer={{ question: '', options: [A, { ...B, fails: { requirement: CAP, quote: 'x'.repeat(10) } }], loading: false }} onChoose={vi.fn()} recordLabel="Record" />);
    expect(screen.getByText(/None of these meets your requirements/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: B.label })).toBeNull();
  });
});

describe('an answer to Go that names an option over a requirement is refused and said (L-274)', () => {
  it('the refusal is shown under the answer box', async () => {
    const onAnswer = vi.fn(async () => {
      throw new ChoiceRefused('Option A breaks your requirement. Nothing was recorded.');
    });
    render(<QuestionPrompt question="Which option?" onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Approve Option A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }));
    await waitFor(() => expect(document.querySelector('[data-answer-refused]')?.textContent).toContain('Nothing was recorded'));
  });
});

describe('Go\'s own question choices naming a failing option are explained, not offered (L-274 follow-up)', () => {
  it('the failing choice is greyed with its reason, the others stay buttons', async () => {
    const { failingChoices } = await import('@/lib/workflow/decision-options');
    const choices = ['Approve Option A ($52,000; $2,000 over the hard budget)', 'Approve Option B ($49,000)'];
    const blocked = failingChoices(choices, [[A, B]]);
    expect(Object.keys(blocked)).toEqual([choices[0]]);
    const onAnswer = vi.fn();
    render(<QuestionPrompt question="Which option do you approve?" choices={choices} blocked={blocked} onAnswer={onAnswer} />);
    expect(screen.queryByRole('button', { name: choices[0] })).toBeNull();
    expect(document.querySelector('[data-option-fails]')!.textContent).toContain('breaks your requirement');
    fireEvent.click(screen.getByRole('button', { name: choices[1] }));
    expect(onAnswer).toHaveBeenCalledWith(choices[1]);
  });

  it('when every choice fails, it says none meets the requirements', async () => {
    const { failingChoices } = await import('@/lib/workflow/decision-options');
    const B2 = { ...B, fails: { requirement: CAP, quote: 'B is $1,500 over the cap' } };
    const choices = ['Approve Option A', 'Approve Option B'];
    render(<QuestionPrompt question="Which?" choices={choices} blocked={failingChoices(choices, [[A, B2]])} onAnswer={vi.fn()} />);
    expect(document.querySelector('[data-none-eligible]')!.textContent).toContain('None of these meets your requirements');
  });
});

