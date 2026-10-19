/**
 * The draft line above the goal box must not move the box while the user
 * types (19 Oct, production pass: it appeared on the first keystroke, then
 * switched between one and two lines on every save).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DraftStatus, type DraftSaveState } from './draft-status';

describe('DraftStatus', () => {
  it('holds its one-line slot before anything is saved', () => {
    render(<DraftStatus state={null} />);
    const slot = screen.getByRole('status', { name: 'Setup draft' });
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveClass('h-5', 'truncate', 'whitespace-nowrap');
  });

  it('is the same single-line element whatever the save state, with the full wording as its title', () => {
    const { rerender } = render(<DraftStatus state={null} />);
    const slot = screen.getByRole('status', { name: 'Setup draft' });
    for (const state of ['saving', 'saved', 'failed', 'saving'] as DraftSaveState[]) {
      rerender(<DraftStatus state={state} />);
      expect(screen.getByRole('status', { name: 'Setup draft' })).toBe(slot);
      expect(slot).toHaveClass('h-5', 'truncate', 'whitespace-nowrap');
      expect(slot.textContent!.length).toBeLessThan(80);
    }
    rerender(<DraftStatus state="saved" />);
    expect(slot).toHaveTextContent('no project exists until you press Start');
    expect(slot).toHaveAttribute('title', expect.stringContaining('you can sign out and come back'));
  });
});
