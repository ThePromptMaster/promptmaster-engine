'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { guestErrorMessage } from '@/lib/auth/guest';
import { forgetResetRequest, nextFromLocation, rememberResetRequest } from '@/lib/auth/next-path';
import { authErrorMessage } from '@/lib/auth/auth-errors';
import { goSignedIn, SignInTimeout } from '@/lib/auth/sign-in';
import { useT } from '@/lib/i18n/i18n-provider';
import { LocaleSwitch } from '@/components/shared/locale-switch';
import { ProviderButtons } from '@/components/shared/provider-buttons';

/**
 * The field and label treatments are shared with the sign-up page, which was
 * rebuilt on these same tokens — the two pages are one link apart and used to
 * look like two different products.
 */
const FIELD_CLASS =
  'w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-body focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-[var(--surface-container-lowest)] transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60';

const LABEL_CLASS =
  'block text-label uppercase tracking-wider text-[var(--on-surface-variant)]';

export default function LoginPage() {
  const t = useT();
  const { signIn, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  // Until the page's script runs, a click would submit the form natively and
  // nothing would sign in (28 Oct), so Sign in waits for it.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const handleGuest = async () => {
    setError(null);
    setGuestLoading(true);
    try {
      await continueAsGuest();
      // Where they were going, as a password sign-in does — a guest who
      // followed a link to a project used to land on the project list.
      goSignedIn(nextFromLocation() ?? '/projects');
    } catch (err) {
      setError(guestErrorMessage(err instanceof Error ? err.message : ''));
      setGuestLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await signIn(email, password);
      forgetResetRequest();
      // A full page load, not router.push: the soft navigation could leave
      // them on this page, signed in, until they refreshed (28 Oct). The
      // button stays on "Signing in…" while the next page loads.
      goSignedIn(nextFromLocation() ?? '/projects');
    } catch (err) {
      setError(err instanceof SignInTimeout ? t('auth.err.timeout') : authErrorMessage(err, 'auth.err.invalid'));
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('auth.err.noEmail'));
      return;
    }
    setError(null);
    setResetLoading(true);
    try {
      const supabase = createClient();
      // Remembered before the request: a send that reports an error may still
      // have gone out, and remembering costs nothing if it did not.
      rememberResetRequest();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        // The bare callback, which is what the redirect allow-list holds; the
        // callback sends this browser's recovery on to the page that sets the
        // new password (it used to land on /projects with the old one intact).
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (resetError) throw resetError;
      setResetSent(true);
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'auth.err.reset'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="bg-[var(--surface)] text-[var(--on-surface)] flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-[420px] space-y-12">
        {/* Minimal Branding Anchor */}
        <header className="text-center space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="PromptMaster" className="w-12 h-12 rounded-xl mx-auto mb-6" />
          <h1 className="text-[var(--on-surface)] text-headline tracking-tight">PromptMaster</h1>
          <p className="text-[var(--on-surface-variant)] text-body">{t('auth.tagline')}</p>
        </header>

        {/* Login Container Well */}
        <section
          className="bg-[var(--surface-container-lowest)] rounded-xl p-8 space-y-6"
          style={{ boxShadow: '0px 4px 20px rgba(25, 28, 30, 0.04)' }}
        >
          {forgotMode ? (
            /* Forgot Password Form */
            <form onSubmit={handleResetPassword} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-[var(--error-container)] px-3 py-2 text-body text-[var(--on-error-container)]">
                  {error}
                </div>
              )}

              {resetSent ? (
                <div className="space-y-4 text-center py-4">
                  <span className="material-symbols-outlined text-[var(--pm-primary)] text-[40px]">mark_email_read</span>
                  <p className="text-body text-[var(--on-surface)]">
                    {t('auth.resetSentTo')} <strong>{email}</strong>
                  </p>
                  <p className="text-label text-[var(--on-surface-variant)]">
                    {t('auth.resetSentHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(false); setResetSent(false); setError(null); }}
                    className="text-body text-[var(--pm-primary)] font-medium hover:underline"
                  >
                    {t('auth.backToSignIn')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <h3 className="text-title text-[var(--on-surface)]">{t('auth.resetTitle')}</h3>
                    <p className="text-label text-[var(--on-surface-variant)]">
                      {t('auth.resetIntro')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      className={LABEL_CLASS}
                      htmlFor="reset-email"
                    >
                      {t('auth.emailAddress')}
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className={FIELD_CLASS}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {resetLoading ? t('auth.sending') : t('auth.sendReset')}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setForgotMode(false); setError(null); }}
                    className="w-full text-center text-body text-[var(--on-surface-variant)] hover:text-[var(--pm-primary)] transition-colors"
                  >
                    {t('auth.backToSignIn')}
                  </button>
                </>
              )}
            </form>
          ) : (
            /* Login Form */
            <form method="post" onSubmit={handleSignIn} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-[var(--error-container)] px-3 py-2 text-body text-[var(--on-error-container)]">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label
                  className={LABEL_CLASS}
                  htmlFor="email"
                >
                  {t('auth.emailAddress')}
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className={FIELD_CLASS}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label
                    className={LABEL_CLASS}
                    htmlFor="password"
                  >
                    {t('auth.password')}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError(null); }}
                    className="text-label text-[var(--pm-primary)] hover:underline transition-all"
                  >
                    {t('auth.forgot')}
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className={FIELD_CLASS}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--outline)] hover:text-[var(--on-surface-variant)]"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !hydrated}
                className="w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? t('auth.signingIn') : t('auth.signIn')}
              </button>
            </form>
          )}

          {!forgotMode && (
            <>
              {/* Divider */}
              <div className="relative py-2 flex items-center gap-4">
                <div className="flex-grow h-[1px] bg-[var(--surface-container-high)]" />
                <span className="text-label font-bold text-[var(--outline)] uppercase tracking-widest">{t('auth.orUpper')}</span>
                <div className="flex-grow h-[1px] bg-[var(--surface-container-high)]" />
              </div>

              <ProviderButtons onError={setError} />
            </>
          )}
        </section>

        {/* Try it without committing to an account. The work is kept against a
            real (anonymous) identity, so it can be claimed later without
            migrating anything. */}
        {!forgotMode && (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--surface-container-high)]" />
              <span className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                {t('auth.or')}
              </span>
              <span className="h-px flex-1 bg-[var(--surface-container-high)]" />
            </div>

            <button
              type="button"
              onClick={handleGuest}
              disabled={guestLoading}
              className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-body font-medium text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-high)] disabled:opacity-60"
            >
              {guestLoading ? t('auth.guestStarting') : t('auth.guest')}
            </button>
            <p className="mt-2 text-center text-label text-[var(--on-surface-variant)]">
              {t('auth.guestNote')}
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-6 text-center">
          <p className="text-body text-[var(--on-surface-variant)]">
            {t('auth.noAccount')}{' '}
            <Link
              href="/auth/signup"
              className="text-[var(--pm-primary)] font-medium hover:underline ms-1"
            >
              {t('auth.signUp')}
            </Link>
          </p>
        </footer>
        <LocaleSwitch />
      </main>

      {/* Decorative Structural Element */}
      <div className="fixed top-0 end-0 p-12 opacity-5 pointer-events-none">
        <span className="material-symbols-outlined" style={{ fontSize: '320px' }}>
          architecture
        </span>
      </div>
    </div>
  );
}
