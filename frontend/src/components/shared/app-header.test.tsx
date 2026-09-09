import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppHeader } from './app-header';

/**
 * The header is the only route out of the account.
 *
 * `signOut` sat on `use-auth` with no caller at all before this — the grep for
 * it returned the hook and nothing else — so the affordance is new and there is
 * nothing already asserting it works. These tests exist so a later refactor of
 * the header cannot quietly take the only exit away again.
 */

const signOut = vi.fn();
const push = vi.fn();

let authState: {
  user: { email?: string } | null;
  loading: boolean;
  isGuest: boolean;
} = { user: { email: 'analyst@example.com' }, loading: false, isGuest: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ ...authState, signOut }),
}));

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  push.mockReset();
  authState = { user: { email: 'analyst@example.com' }, loading: false, isGuest: false };
});

describe('AppHeader', () => {
  it('carries the product identity, linked home', () => {
    render(<AppHeader />);

    expect(screen.getByText('PromptMaster')).toBeTruthy();
    const home = screen.getByRole('link', { name: /promptmaster/i });
    expect(home.getAttribute('href')).toBe('/projects');
  });

  it('signs out and returns to the login page', async () => {
    const user = userEvent.setup();
    render(<AppHeader />);

    // Sign-out is behind the account control, so getting to it is part of the
    // affordance being tested.
    await user.click(screen.getByRole('button', { name: /account/i }));

    const signOutButton = screen.getByRole('menuitem', { name: /sign out/i });
    await user.click(signOutButton);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/auth/login');
  });

  it('shows the signed-in identity in the menu', async () => {
    const user = userEvent.setup();
    render(<AppHeader />);

    await user.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getAllByText('analyst@example.com').length).toBeGreaterThan(0);
  });

  it('names a guest as a guest rather than showing an empty email', async () => {
    authState = { user: { email: undefined }, loading: false, isGuest: true };
    const user = userEvent.setup();
    render(<AppHeader />);

    await user.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getAllByText('Guest').length).toBeGreaterThan(0);
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy();
  });

  it('renders no account control until the session has resolved', () => {
    authState = { user: null, loading: true, isGuest: false };
    render(<AppHeader />);

    expect(screen.queryByRole('button', { name: /account/i })).toBeNull();
    // Identity still shows — the header does not flicker in and out.
    expect(screen.getByText('PromptMaster')).toBeTruthy();
  });

  it('closes the menu on Escape without signing out', async () => {
    const user = userEvent.setup();
    render(<AppHeader />);

    await user.click(screen.getByRole('button', { name: /account/i }));
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});
