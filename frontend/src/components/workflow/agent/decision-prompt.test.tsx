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
