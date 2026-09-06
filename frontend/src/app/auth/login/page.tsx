'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleGuest = async () => {
    setError(null);
    setGuestLoading(true);
    try {
      await continueAsGuest();
      router.push('/projects');
    } catch (err) {
      // The project's anonymous provider can be turned off, in which case
      // saying so is more useful than a generic failure.
      const message = err instanceof Error ? err.message : '';
      setError(
        /anonymous/i.test(message)
          ? 'Guest access is turned off for this workspace. Sign in or create an account to continue.'
          : message || 'Could not start a guest session.'
      );
      setGuestLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await signIn(email, password);
      router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed.');
      setIsGoogleLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setError(null);
    setResetLoading(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (resetError) throw resetError;
      setResetSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="bg-[var(--surface)] text-[var(--on-surface)] flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-[420px] space-y-12">
        {/* Minimal Branding Anchor */}
        <header className="text-center space-y-2">
          <img src="/logo.svg" alt="PromptMaster" className="w-12 h-12 rounded-xl mx-auto mb-6" />
          <h1 className="text-[var(--on-surface)] font-bold text-xl tracking-tighter">PromptMaster</h1>
          <p className="text-[var(--on-surface-variant)] text-sm">A system for thinking with AI</p>
        </header>

        {/* Login Container Well */}
        <section
          className="bg-white rounded-xl p-8 space-y-6"
          style={{ boxShadow: '0px 4px 20px rgba(25, 28, 30, 0.04)' }}
        >
          {forgotMode ? (
            /* Forgot Password Form */
            <form onSubmit={handleResetPassword} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              {resetSent ? (
                <div className="space-y-4 text-center py-4">
                  <span className="material-symbols-outlined text-[var(--pm-primary)] text-[40px]">mark_email_read</span>
                  <p className="text-sm text-[var(--on-surface)]">
                    Password reset link sent to <strong>{email}</strong>
                  </p>
                  <p className="text-xs text-[var(--on-surface-variant)]">
                    Check your inbox and follow the link to reset your password.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(false); setResetSent(false); setError(null); }}
                    className="text-sm text-[var(--pm-primary)] font-medium hover:underline"
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-[var(--on-surface)]">Reset your password</h3>
                    <p className="text-xs text-[var(--on-surface-variant)]">
                      Enter your email and we&apos;ll send you a link to reset your password.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      className="block text-xs font-medium text-[var(--on-surface-variant)] uppercase tracking-wider"
                      htmlFor="reset-email"
                    >
                      Email Address
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className="w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-sm focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-white transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full py-3 px-4 bg-[var(--pm-primary)] text-white font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {resetLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setForgotMode(false); setError(null); }}
                    className="w-full text-center text-sm text-[var(--on-surface-variant)] hover:text-[var(--pm-primary)] transition-colors"
                  >
                    Back to Sign In
                  </button>
                </>
              )}
            </form>
          ) : (
            /* Login Form */
            <form onSubmit={handleSignIn} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label
                  className="block text-xs font-medium text-[var(--on-surface-variant)] uppercase tracking-wider"
                  htmlFor="email"
                >
                  Email Address
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
                  className="w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-sm focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-white transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label
                    className="block text-xs font-medium text-[var(--on-surface-variant)] uppercase tracking-wider"
                    htmlFor="password"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setError(null); }}
                    className="text-xs text-[var(--pm-primary)] hover:underline transition-all"
                  >
                    Forgot password?
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
                    className="w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-sm focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-white transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--outline)] hover:text-[var(--on-surface-variant)]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-[var(--pm-primary)] text-white font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          {!forgotMode && (
            <>
              {/* Divider */}
              <div className="relative py-2 flex items-center gap-4">
                <div className="flex-grow h-[1px] bg-[var(--surface-container-high)]" />
                <span className="text-[10px] font-bold text-[var(--outline)] uppercase tracking-widest">OR</span>
                <div className="flex-grow h-[1px] bg-[var(--surface-container-high)]" />
              </div>

              {/* Google Sign In */}
              <button
                type="button"
                disabled={isGoogleLoading}
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-[var(--outline-variant)]/30 text-[var(--on-surface)] font-medium rounded-lg hover:bg-[var(--surface-container-low)] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
            <svg fill="none" height="18" viewBox="0 0 24 24" width="18" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {isGoogleLoading ? 'Redirecting...' : 'Sign in with Google'}
              </button>
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
              <span className="text-xs uppercase tracking-wider text-[var(--on-surface-variant)]">
                or
              </span>
              <span className="h-px flex-1 bg-[var(--surface-container-high)]" />
            </div>

            <button
              type="button"
              onClick={handleGuest}
              disabled={guestLoading}
              className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-sm font-medium text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-high)] disabled:opacity-60"
            >
              {guestLoading ? 'Starting…' : 'Continue without an account'}
            </button>
            <p className="mt-2 text-center text-xs text-[var(--on-surface-variant)]">
              Your work stays in this browser until you create an account.
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-6 text-center">
          <p className="text-sm text-[var(--on-surface-variant)]">
            Don&apos;t have an account?{' '}
            <Link
              href="/auth/signup"
              className="text-[var(--pm-primary)] font-medium hover:underline ml-1"
            >
              Sign up
            </Link>
          </p>
        </footer>
      </main>

      {/* Decorative Structural Element */}
      <div className="fixed top-0 right-0 p-12 opacity-5 pointer-events-none">
        <span className="material-symbols-outlined" style={{ fontSize: '320px' }}>
          architecture
        </span>
      </div>
    </div>
  );
}
