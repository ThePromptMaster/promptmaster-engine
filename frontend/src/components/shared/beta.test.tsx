import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BetaNotice, BETA_NOTICE_STORAGE_KEY } from './beta-notice';
import { FeedbackForm } from './feedback-form';

const submitFeedback = vi.fn();

vi.mock('@/lib/supabase/feedback', () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, isGuest: false }),
}));

/**
 * This jsdom environment ships without a Storage implementation, so the notice
 * exercises its own try/catch fallback rather than its remembering path. A
 * minimal in-memory stand-in restores the behaviour a browser actually has.
 */
function installLocalStorage() {
  const entries = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: stub,
  });
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
  submitFeedback.mockReset();
  submitFeedback.mockResolvedValue({ id: 'f1' });
});

describe('BetaNotice', () => {
  /**
   * FR-22 acceptance criterion, asserted on the copy itself: the notice must
   * say it is an early beta, that outputs require review, that
   * production-critical reliance is not intended, and that sensitive
   * information must not be entered.
   */
  it('states every thing FR-22 requires it to state', () => {
    render(<BetaNotice />);

    const all = document.body.textContent ?? '';

    expect(all).toMatch(/early beta/i);
    expect(all).toMatch(/outputs require review/i);
    expect(all).toMatch(/production-critical reliance is not intended/i);
    expect(all).toMatch(/do not enter sensitive information/i);
  });

  it('remembers dismissal but stays reachable afterwards', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BetaNotice />);

    await user.click(screen.getByRole('button', { name: /got it/i }));

    expect(localStorage.getItem(BETA_NOTICE_STORAGE_KEY)).toBe('dismissed');
    expect(screen.queryByText(/production-critical reliance is not intended/i)).toBeNull();

    // The affordance back in is present immediately...
    const chip = screen.getByRole('button', { name: /show the beta notice/i });
    await user.click(chip);
    expect(screen.getByText(/production-critical reliance is not intended/i)).toBeTruthy();

    // ...and the dismissal survives a fresh mount.
    unmount();
    localStorage.setItem(BETA_NOTICE_STORAGE_KEY, 'dismissed');
    render(<BetaNotice />);
    expect(screen.queryByText(/production-critical reliance is not intended/i)).toBeNull();
    expect(screen.getByRole('button', { name: /show the beta notice/i })).toBeTruthy();
  });
});

describe('FeedbackForm', () => {
  it('captures the four FR-22 answers and submits them', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm projectId="p1" />);

    await user.type(
      screen.getByLabelText(/what were you trying to do/i),
      'Draft a compliance memo'
    );
    await user.type(screen.getByLabelText(/what was valuable/i), 'The stage gates');
    await user.type(
      screen.getByLabelText(/where did you get confused or blocked/i),
      'Naming the outline sections'
    );
    await user.click(screen.getByRole('button', { name: '4' }));

    await user.click(screen.getByRole('button', { name: /send feedback/i }));

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(submitFeedback).toHaveBeenCalledWith(
      {
        use_case: 'Draft a compliance memo',
        value: 'The stage gates',
        blockage: 'Naming the outline sections',
        reuse_likelihood: 4,
        project_id: 'p1',
      },
      'user-1'
    );

    expect(await screen.findByText(/thank you/i)).toBeTruthy();
  });
});
