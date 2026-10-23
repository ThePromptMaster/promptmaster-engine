import { afterEach, describe, expect, it } from 'vitest';

import { authErrorMessage } from './auth-errors';
import { guestErrorMessage } from './guest';
import { resetLocaleForTests, setLocale } from '@/lib/i18n/store';

/** 23 Oct: the whole site in the chosen language — Supabase's errors included. */
describe('sign-in errors in the interface language', () => {
  afterEach(() => {
    setLocale('en');
    resetLocaleForTests();
  });

  it('shows Supabase\'s own message in English, as before', () => {
    setLocale('en');
    expect(authErrorMessage(Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }), 'auth.err.invalid')).toBe('Invalid login credentials');
    expect(authErrorMessage(null, 'auth.err.invalid')).toBe('Invalid email or password.');
  });

  it('turns a known code into a sentence in another language', () => {
    setLocale('es');
    expect(authErrorMessage(Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }), 'auth.err.invalid')).toBe('El correo o la contraseña no son correctos.');
    expect(authErrorMessage({ message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit' }, 'auth.err.reset')).toMatch(/^Se enviaron demasiados correos/);
  });

  it('keeps Supabase\'s words after the page\'s own sentence when the code is unknown', () => {
    setLocale('fr');
    expect(authErrorMessage(new Error('Something odd'), 'auth.err.create')).toBe("Le compte n'a pas pu être créé. (Something odd)");
  });

  it('guest errors follow the language too, and stay the same in English', () => {
    setLocale('en');
    expect(guestErrorMessage('Request rate limit reached')).toMatch(/^Too many guest sessions/);
    setLocale('pt');
    expect(guestErrorMessage('Anonymous sign-ins are disabled')).toBe('O acesso de convidado está desativado. Entre ou crie uma conta para continuar.');
  });
});
