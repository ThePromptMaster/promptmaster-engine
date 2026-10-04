'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { forgetResetRequest } from '@/lib/auth/next-path';

/**
 * Set a new password, reached from the reset email through the callback.
 *
 * "Forgot password" used to send an email whose link signed the user in and
 * dropped them on the project list with their old password unchanged — there
 * was no page to set a new one (4 Oct). The link's recovery session is what
 * authorises `updateUser` here; without one the link has expired or been used.
 */

const FIELD_CLASS =
  'w-full px-4 py-3 bg-[var(--surface-container-low)] border-none rounded-lg text-[var(--on-surface)] text-body focus:ring-2 focus:ring-[var(--pm-primary)]/40 focus:bg-[var(--surface-container-lowest)] transition-all duration-200 outline-none placeholder:text-[var(--outline)]/60';

const LABEL_CLASS =
  'block text-label uppercase tracking-wider text-[var(--on-surface-variant)]';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      setHasSession(Boolean(data.session));
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      forgetResetRequest();
      router.replace('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the new password.');
      setSaving(false);
    }
  };

  return (
    <div className="bg-[var(--surface)] text-[var(--on-surface)] flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-[420px] space-y-10">
        <header className="text-center space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="PromptMaster" className="w-12 h-12 rounded-xl mx-auto mb-6" />
          <h1 className="text-[var(--on-surface)] text-headline tracking-tight">Set a new password</h1>
        </header>

        {hasSession === null ? (
          <p className="text-center text-body text-[var(--on-surface-variant)]">Checking your reset link…</p>
        ) : !hasSession ? (
          <div className="space-y-5 text-center">
            <p className="text-body text-[var(--on-surface-variant)]">
              This reset link has expired or was already used. Ask for a new one from the sign-in page.
            </p>
            <Link
              href="/auth/login"
              className="inline-block w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg text-title"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="new-password" className={LABEL_CLASS}>New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password" className={LABEL_CLASS}>Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={FIELD_CLASS}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-body text-[var(--pm-error)]">{error}</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 px-4 bg-[var(--pm-primary)] text-[var(--on-primary)] font-semibold rounded-lg text-title disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
