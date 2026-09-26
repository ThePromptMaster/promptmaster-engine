'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [timeoutError, setTimeoutError] = useState<string | null>(null);

  // Supabase redirects with ?error=...; that error is derived from the URL during
  // render rather than copied into state from an effect.
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const urlError = errorParam
    ? errorDescription
      ? errorDescription.replace(/\+/g, ' ')
      : 'Authentication failed. Please try again.'
    : null;
  const error = urlError ?? timeoutError;

  useEffect(() => {
    if (urlError) return;

    // No error — proceed with auth exchange
    const supabase = createClient();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_IN') {
        router.push('/projects');
      }
    });

    // Timeout — if no auth event after 10s, show error
    const timeout = setTimeout(() => {
      setTimeoutError('Sign in timed out. Please try again.');
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router, urlError]);

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
