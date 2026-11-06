import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FactsNextStep, OfferedChangeNotice } from './facts-next-step';

/** 5 Nov (a rollout pack): adding to the deliverable takes an explicit change. */
describe('what a fact recorded from the chat may affect', () => {
  it('says nothing has changed, and offers both ways on', async () => {
    const onUpdate = vi.fn();
    const onKeep = vi.fn();
    render(<FactsNextStep judging={false} waiting={[]} updating={false} offered={{ names: ['Final pack'], onUpdate, onKeep }} />);
    expect(screen.getByText('This may affect Final pack. Nothing has changed.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Update Final pack with this' }));
    expect(onUpdate).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Keep on record only' }));
    expect(onKeep).toHaveBeenCalledOnce();
  });

  it('with nothing offered, says what it said before', () => {
    render(<FactsNextStep judging={false} waiting={[]} updating={false} />);
    expect(screen.getByText('Nothing finished relied on these, so nothing needs updating.')).toBeInTheDocument();
  });

  it('on a finished project, nothing was judged, so it does not say nothing relied on them', () => {
    render(<FactsNextStep judging={false} waiting={[]} updating={false} finished />);
    expect(screen.getByText('This project is finished, so nothing was reopened. To bring these into the work, press Continue improving.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing finished relied on these, so nothing needs updating.')).toBeNull();
  });

  it('the notice at the top of the page says why, and does the same', async () => {
    const onUpdate = vi.fn();
    render(<OfferedChangeNotice names={['Final pack']} reasons={['It says the drafts are unsent.']} onUpdate={onUpdate} onKeep={() => undefined} updating={false} />);
    expect(screen.getByRole('status', { name: 'What a recorded fact may affect' })).toHaveTextContent('It says the drafts are unsent.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update Final pack with this' }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});
