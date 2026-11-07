import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { enabledProviders } from '@/lib/auth/providers';

import { ProviderButtons } from './provider-buttons';

const signInWithProvider = vi.fn(async (_provider: string) => {});
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signInWithProvider }) }));

describe('enabledProviders', () => {
  it('offers Google alone until the deployment says otherwise', () => {
    expect(enabledProviders(undefined)).toEqual(['google']);
    expect(enabledProviders('')).toEqual(['google']);
  });

  it('adds what is turned on, in a fixed order, and ignores what it does not know', () => {
    expect(enabledProviders(' custom:yahoo, github ,facebook')).toEqual(['google', 'github', 'custom:yahoo']);
    expect(enabledProviders('custom:yahoo,google')).toEqual(['google', 'custom:yahoo']);
  });
});

describe('ProviderButtons', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a button for each provider, named', () => {
    render(<ProviderButtons providers={['google', 'github', 'custom:yahoo']} onError={vi.fn()} />);
    for (const name of ['Google', 'GitHub', 'Yahoo']) {
      expect(screen.getByRole('button', { name: `Sign in with ${name}` })).toBeInTheDocument();
    }
  });

  it('asks for the provider pressed, and says which one failed', async () => {
    const onError = vi.fn();
    signInWithProvider.mockRejectedValueOnce(new Error(''));
    render(<ProviderButtons providers={['google', 'custom:yahoo']} onError={onError} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with Yahoo' }));
    expect(signInWithProvider).toHaveBeenCalledWith('custom:yahoo');
    expect(onError).toHaveBeenLastCalledWith('Yahoo sign in failed.');
    // The button comes back to try again.
    expect(screen.getByRole('button', { name: 'Sign in with Yahoo' })).toBeEnabled();
  });

  it('says what signing in shares, and that mail and files are read only once connected', () => {
    render(<ProviderButtons providers={['google']} onError={vi.fn()} />);
    expect(
      screen.getByText('Signing in shares your name and email. PromptMaster reads your mail, calendar or files only if you connect them, and only what you choose.')
    ).toBeInTheDocument();
  });
});
