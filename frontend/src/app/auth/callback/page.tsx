'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { safeNext } from '@/lib/auth/next-path';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [timeoutError, setTimeoutError] = useState<string | null>(null);

  // Supabase redirects with ?error=...; that error is derived from the URL during
  // render rather than copied into state from an effect.
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const next = safeNext(searchParams.get('next')) ?? '/projects';
  const tokenHash = searchParams.get('token_hash');
  const otpType = searchParams.get('type');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const urlError = errorParam
    ? errorDescription
      ? errorDescription.replace(/\+/g, ' ')
      : 'Authentication failed. Please try again.'
    : null;
  const error = urlError ?? verifyError ?? timeoutError;

  useEffect(() => {
    if (urlError) return;

    // No error — proceed with auth exchange
    const supabase = createClient();

    let done = false;
    // Timeout — if nothing has signed in after 10s, say so.
    const timeout = setTimeout(() => {
      if (!done) setTimeoutError('Sign in timed out. Please try again.');
    }, 10000);
    const go = (to: string) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      router.replace(to);
    };

    // A link carrying a token hash (an email template pointing here, or an
    // admin-issued link) is verified directly. Unlike the code exchange it does
    // not depend on this browser having asked for the email, so a reset link
    // opened on a phone works too.
    if (tokenHash && otpType) {
      void supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: otpType as 'recovery' | 'signup' | 'magiclink' | 'invite' | 'email' | 'email_change' })
        .then(({ error: otpError }: { error: { message: string } | null }) => {
          if (otpError) {
            done = true;
            clearTimeout(timeout);
            setVerifyError(otpError.message || 'This link has expired or was already used.');
          } else go(otpType === 'recovery' ? '/auth/reset' : next);
        });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      // A password-reset link signs in with a recovery session; that one goes
      // to the page that sets the new password, wherever `next` says.
      if (event === 'PASSWORD_RECOVERY') go('/auth/reset');
      else if (event === 'SIGNED_IN') go(next);
    });

    // The browser client is a singleton that exchanges the URL's code as soon
    // as it is created, which can be before this listener exists. A session
    // already in hand is the same as having heard SIGNED_IN.
    if (!tokenHash) {
      void supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
        if (data.session) go(next);
      });
    }


    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router, urlError, next, tokenHash, otpType]);

  if (error) {
    return (
      <div className="bg-[var(--surface)] flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-[400px] text-center space-y-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-50 rounded-2xl">
            <span className="material-symbols-outlined text-red-500 text-[28px]">error</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-[var(--on-surface)]">
              Authentication Error
            </h2>
            <p className="text-body text-[var(--on-surface-variant)] leading-relaxed">
              {error}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href="/auth/login"
              className="w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg hover:bg-[var(--pm-primary-container)] active:scale-[0.98] transition-all duration-200 text-center text-title"
            >
              Back to Sign In
            </Link>
            <button
              onClick={() => router.back()}
              className="text-body text-[var(--on-surface-variant)] hover:text-[var(--pm-primary)] transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] flex min-h-screen items-center justify-center p-6">
      <div className="text-center space-y-4">
        <span className="material-symbols-outlined text-[var(--pm-primary)] text-[32px] animate-spin">
          progress_activity
        </span>
        <p className="text-body text-[var(--on-surface-variant)]">Completing sign in...</p>
      </div>
    </div>
  );
}
