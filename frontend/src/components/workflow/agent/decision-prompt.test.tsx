import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuestionPrompt } from './decision-prompt';

const contradiction = {
  document: 'Experiment or investigation', version: 1, quote: 'Cycle 3 explicit check at n = 5 | not run',
  claim: 'the Experiment record contains S_5 = 12', explanation: 'Experiment marks the n = 5 check not run.',
};

describe('an answer that contradicts the record is put to the user first (L-65, 9 Oct)', () => {
  it('shows what the record says, and records only on "anyway", with the contradiction', async () => {
    const onAnswer = vi.fn();
    render(<QuestionPrompt question="Is the n = 5 check settled?" onAnswer={onAnswer} checkAnswer={async () => contradiction} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Yes, the Experiment record has it.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }));
    const alert = await screen.findByRole('alert', { name: 'Your answer and the record disagree' });
    expect(alert.textContent).toContain('Experiment or investigation (v1) says:');
    expect(alert.textContent).toContain('Cycle 3 explicit check at n = 5 | not run');
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Record my answer anyway' }));
    expect(onAnswer).toHaveBeenCalledWith('Yes, the Experiment record has it.', contradiction);
  });

  it('"Edit my answer" clears it; with nothing contradicted the answer goes straight through', async () => {
    const onAnswer = vi.fn();
    const { unmount } = render(<QuestionPrompt question="q" onAnswer={onAnswer} checkAnswer={async () => contradiction} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit my answer' }));
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();

    render(<QuestionPrompt question="q" onAnswer={onAnswer} checkAnswer={async () => null} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'December 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('December 10'));
  });
});

describe('a question that is a choice (13 Oct, PINE)', () => {
  it('offers each answer as a button, and the text box for anything else', async () => {
    const { QuestionPrompt: Q } = await import('./decision-prompt');
    const onAnswer = vi.fn();
    render(<Q question="Which version should govern?" choices={['Use the 98-word version', 'Keep the visible version']} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use the 98-word version' }));
    expect(onAnswer).toHaveBeenCalledWith('Use the 98-word version');
    expect(screen.getByPlaceholderText('Or say something else…')).toBeTruthy();
  });
});

describe('a question about an applied finding shows what it changed (19 Oct, Research › Method)', () => {
  const change = {
    stageLabel: 'Method', version: 4, previous: 3,
    before: 'Effect size 13.5% from prior work.', after: 'Effect size to be estimated from the pilot.',
    summary: 'Applied from the stage check: 4 figures have no source in the project',
  };

  it('names the versions and the finding, and opens to the change itself', () => {
    render(<QuestionPrompt question="Which version of the Method should go forward?" onAnswer={vi.fn()} change={change} />);
    const box = screen.getByLabelText('What changed');
    expect(box.textContent).toContain('What changed in Method v4 (against v3)');
    expect(box.textContent).toContain('4 figures have no source');
    expect(screen.queryByTestId('what-changed-diff')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /What changed in Method v4/ }));
    const diff = screen.getByTestId('what-changed-diff');
    const text = (tag: string) => [...diff.querySelectorAll(tag)].map((n) => n.textContent).join(' ');
    expect(text('del')).toContain('13.5%');
    expect(text('ins')).toContain('pilot');
  });

  it('is absent when the question is not about such a version', () => {
    render(<QuestionPrompt question="Anything else?" onAnswer={vi.fn()} />);
    expect(screen.queryByLabelText('What changed')).not.toBeInTheDocument();
  });
});
