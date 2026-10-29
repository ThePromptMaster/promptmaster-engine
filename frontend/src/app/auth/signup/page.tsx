'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { authErrorMessage } from '@/lib/auth/auth-errors';
import { goSignedIn } from '@/lib/auth/sign-in';
import { useT } from '@/lib/i18n/i18n-provider';
import { LocaleSwitch } from '@/components/shared/locale-switch';

/**
 * Create an account.
 *
 * This was the only page in the app built out of `components/ui/` — Card,
 * Button, Input, Label — while login next door is hand-built on the design
 * tokens. The two sat one link apart and looked like two different products:
 * different surface colours (#F8FAFC against var(--surface)), different
 * accent blues (#2563EB against var(--pm-primary)), a hairline border under
 * the card header where the system separates by tone, and a shadcn button
 * with an inline style overriding its own variant.
 *
 * It is now the same page as login with different fields in it: same shell,
 * same branding block, same field treatment, same primary button, same
 * decorative glyph. Nothing about the sign-up behaviour changed.
 */

const FIELD_CLASS =
  'w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-body focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-[var(--surface-container-lowest)] transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60';

const LABEL_CLASS =
  'block text-label uppercase tracking-wider text-[var(--on-surface-variant)]';

export default function SignupPage() {
  const { signUp } = useAuth();
  const t = useT();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // As on the sign-in page: a click before the script runs would submit natively.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t('auth.err.tooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.err.mismatch'));
      return;
    }

    setIsLoading(true);
    try {
      // Where confirmation is off the account is already signed in: "check
      // your email" would send them looking for a message that never comes.
      const signedIn = await signUp(email, password, fullName);
      // A full page load, so the proxy sees the new session (28 Oct).
      if (signedIn) goSignedIn('/projects');
      else setSuccess(true);
    } catch (err) {
      setError(authErrorMessage(err, 'auth.err.create'));
    } finally {
      setIsLoading(false);
    }
  };

  const branding = (
    <header className="text-center space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="PromptMaster" className="w-12 h-12 rounded-xl mx-auto mb-6" />
      <h1 className="text-[var(--on-surface)] text-headline tracking-tight">PromptMaster</h1>
      <p className="text-[var(--on-surface-variant)] text-body">{t('auth.tagline')}</p>
    </header>
  );

  const decoration = (
    <div className="fixed top-0 end-0 p-12 opacity-5 pointer-events-none">
      <span className="material-symbols-outlined" style={{ fontSize: '320px' }}>
        architecture
      </span>
    </div>
  );

  if (success) {
    return (
      <div className="bg-[var(--surface)] text-[var(--on-surface)] flex min-h-screen items-center justify-center p-6">
        <main className="w-full max-w-[420px] space-y-12">
          {branding}

          <section
            className="bg-[var(--surface-container-lowest)] rounded-xl p-8 text-center space-y-4"
            style={{ boxShadow: '0px 4px 20px rgba(25, 28, 30, 0.04)' }}
          >
            <span
              aria-hidden
              className="material-symbols-outlined text-[var(--pm-primary)] text-[40px]"
            >
              mark_email_read
            </span>
            <h2 className="text-title text-[var(--on-surface)]">{t('auth.checkEmail')}</h2>
            <p className="text-body text-[var(--on-surface-variant)]">
              {t('auth.confirmSentTo')}{' '}
              <strong className="text-[var(--on-surface)]">{email}</strong>{t('auth.confirmSentAfter')}
            </p>
            <Link
              href="/auth/login"
              className="inline-block text-body font-medium text-[var(--pm-primary)] hover:underline"
            >
              {t('auth.backToSignInLower')}
            </Link>
          </section>
        </main>

        {decoration}
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] text-[var(--on-surface)] flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-[420px] space-y-12">
        {branding}

        <section
          className="bg-[var(--surface-container-lowest)] rounded-xl p-8 space-y-6"
          style={{ boxShadow: '0px 4px 20px rgba(25, 28, 30, 0.04)' }}
        >
          <div className="space-y-1">
            <h2 className="text-title text-[var(--on-surface)]">{t('auth.createTitle')}</h2>
            <p className="text-label text-[var(--on-surface-variant)]">
              {t('auth.createIntro')}
            </p>
          </div>

          <form method="post" onSubmit={handleSignUp} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-[var(--error-container)] px-3 py-2 text-body text-[var(--on-error-container)]">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="fullName">
                {t('auth.fullName')}
              </label>
              <input
                id="fullName"
                type="text"
                placeholder={t('auth.fullNamePlaceholder')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="email">
                {t('auth.emailAddressLower')}
              </label>
              <input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="password">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="confirmPassword">
                {t('auth.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                placeholder={t('auth.confirmPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={FIELD_CLASS}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !hydrated}
              className="w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? t('auth.creating') : t('auth.createAccount')}
            </button>
          </form>
        </section>

        <footer className="mt-6 text-center">
          <p className="text-body text-[var(--on-surface-variant)]">
            {t('auth.haveAccount')}{' '}
            <Link
              href="/auth/login"
              className="text-[var(--pm-primary)] font-medium hover:underline ms-1"
            >
              {t('auth.signInLower')}
            </Link>
          </p>
        </footer>
        <LocaleSwitch />
      </main>

      {decoration}
    </div>
  );
}
