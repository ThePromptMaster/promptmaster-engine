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
    expect(enabledProviders(' github, azure ,facebook')).toEqual(['google', 'azure', 'github']);
    expect(enabledProviders('custom:yahoo,google')).toEqual(['google', 'custom:yahoo']);
  });
});

describe('ProviderButtons', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a button for each provider, named', () => {
    render(<ProviderButtons providers={['google', 'azure', 'github', 'custom:yahoo']} onError={vi.fn()} />);
    for (const name of ['Google', 'Microsoft', 'GitHub', 'Yahoo']) {
      expect(screen.getByRole('button', { name: `Sign in with ${name}` })).toBeInTheDocument();
    }
  });

  it('asks for the provider pressed, and says which one failed', async () => {
    const onError = vi.fn();
    signInWithProvider.mockRejectedValueOnce(new Error(''));
    render(<ProviderButtons providers={['google', 'azure']} onError={onError} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(signInWithProvider).toHaveBeenCalledWith('azure');
    expect(onError).toHaveBeenLastCalledWith('Microsoft sign in failed.');
    // The button comes back to try again.
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeEnabled();
  });
});
