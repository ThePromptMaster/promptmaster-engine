import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { I18nProvider, useT } from './i18n-provider';
import { resetLocaleForTests, setLocale } from './store';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/projects' }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'a@example.com' }, loading: false, isGuest: false, signOut: vi.fn() }),
}));

import { AppHeader } from '@/components/shared/app-header';

function SignOutWord() {
  const t = useT();
  return <p>{t('header.signOut')}</p>;
}

afterEach(() => {
  window.localStorage.clear();
  document.cookie = 'pm.locale=; path=/; max-age=0';
  resetLocaleForTests();
  document.documentElement.lang = 'en';
});

describe('the interface language (client, 21 Oct)', () => {
  it('switches every word at once and sets the page language', () => {
    render(<I18nProvider><SignOutWord /></I18nProvider>);
    expect(screen.getByText('Sign out')).toBeTruthy();
    act(() => setLocale('es'));
    expect(screen.getByText('Cerrar sesión')).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('pm.locale')).toBe('es');
    expect(document.cookie).toContain('pm.locale=es');
  });

  it('starts in the language chosen before', () => {
    window.localStorage.setItem('pm.locale', 'fr');
    render(<I18nProvider><SignOutWord /></I18nProvider>);
    expect(screen.getByText('Se déconnecter')).toBeTruthy();
  });

  it('is chosen from the account menu, each language by its own name', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><AppHeader /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('menuitem', { name: /language/i }));
    await user.click(screen.getByRole('button', { name: 'Português' }));
    expect(screen.getByRole('menuitem', { name: /sair/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Português' }).getAttribute('aria-pressed')).toBe('true');
  });
});
