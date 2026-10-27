import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CompletionDialog } from './stage-status-panels';
import { ProjectFinishedBanner } from './project-finished-banner';
import type { CompletionSummary } from '@/lib/workflow/engine';

/**
 * A tester, via Sean (26 Oct): "I want a check all the boxes and finish
 * option … a shortcut button with potential caveat to come back if answer
 * isn't what we had hoped."
 */
const summary: CompletionSummary = {
  deliverable: undefined,
  deliverableDone: false,
  completed: 1,
  withArtifact: 1,
  skipped: 0,
  leftOpen: 0,
  leftOpenStages: [],
  blocked: 0,
  notStarted: 3,
  outstanding: [{ kind: 'unmet_blocking', stageId: 'review', label: 'Review', criteria: ['I have read the plan'] }],
} as CompletionSummary;

describe('finishing with what you have', () => {
  it('asks no reason, and lists what is open as not done yet', async () => {
    const onConfirm = vi.fn();
    render(<CompletionDialog summary={summary} early busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Finish with what you have?' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Not done yet' })).toHaveTextContent('Review');
    expect(screen.queryByLabelText(/why/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Finish/ }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('still asks why when the last stage is finished past open work', () => {
    render(<CompletionDialog summary={summary} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Finish with what you have?' })).toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('says on the finished project what was not done, with the way back to each', async () => {
    const onGoBack = vi.fn();
    render(<ProjectFinishedBanner onReopen={vi.fn()} notDone={[{ text: 'Review: I have read the plan', stageId: 'review' }]} onGoBack={onGoBack} />);
    expect(screen.getByText('Finished early — not done yet:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go back to this' }));
    expect(onGoBack).toHaveBeenCalledWith('review');
  });
});
