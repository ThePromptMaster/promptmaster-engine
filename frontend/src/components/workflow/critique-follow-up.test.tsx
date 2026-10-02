import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CritiqueFollowUp } from './critique-follow-up';
import { pointsFromCommentary } from '@/lib/workflow/critique-points';
import type { ReplyAction } from '@/types';

// A critique long enough to have become twenty Apply buttons.
const text = Array.from({ length: 20 }, (_, i) => `- Point number ${i + 1} explains something about the draft.`).join('\n');
const commentary = { title: 'Challenge', text };
const points = pointsFromCommentary(text);
const actions: ReplyAction[] = [
  { kind: 'revise', label: 'Mark all sources unverified', instruction: 'Say that none of the sources is verified.' },
  { kind: 'revise', label: 'Add a verification plan', instruction: 'Add how each source will be verified.' },
];

type Suggest = (question: string, reply: string, signal: AbortSignal) => Promise<ReplyAction[]>;

function setup(suggest = vi.fn<Suggest>(async () => actions)) {
  const onRun = vi.fn();
  const onApplyPoints = vi.fn();
  render(<CritiqueFollowUp commentary={commentary} points={points} busy={false} suggest={suggest} onRun={onRun} onApplyPoints={onApplyPoints} />);
  return { suggest, onRun, onApplyPoints };
}

describe('a critique ends in a few actions, not one per point (2 Oct, item 6)', () => {
  it('asks once for actions and shows those, with "Do nothing" — not twenty Apply buttons', async () => {
    const { suggest, onRun } = setup();
    expect(points).toHaveLength(20);
    const few = await screen.findByRole('region', { name: 'Act on this critique' });
    expect(within(few).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark all sources unverified', 'Add a verification plan', 'Do nothing']);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][1]).toBe(text);
    expect(screen.queryByText(/Apply all 20 recommended fixes/)).not.toBeVisible();

    await userEvent.click(within(few).getByRole('button', { name: 'Mark all sources unverified' }));
    expect(onRun).toHaveBeenCalledWith(actions[0]);
  });

  it('keeps the points, one by one, behind a disclosure that starts closed', async () => {
    setup();
    await screen.findByRole('region', { name: 'Act on this critique' });
    const disclosure = screen.getByText('Review the 20 points one by one').closest('details')!;
    expect(disclosure.open).toBe(false);
    await userEvent.click(screen.getByText('Review the 20 points one by one'));
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByRole('region', { name: 'Each point of this critique' })).toBeInTheDocument();
  });

  it('"Do nothing" puts the actions away; a failed request leaves the points', async () => {
    setup(vi.fn<Suggest>(async () => { throw new Error('down'); }));
    const few = await screen.findByRole('region', { name: 'Act on this critique' });
    expect(within(few).getByText('Could not work out actions for this. The points are below.')).toBeInTheDocument();
    await userEvent.click(within(few).getByRole('button', { name: 'Do nothing' }));
    expect(screen.queryByRole('region', { name: 'Act on this critique' })).not.toBeInTheDocument();
    expect(screen.getByText('Review the 20 points one by one')).toBeInTheDocument();
  });
});
