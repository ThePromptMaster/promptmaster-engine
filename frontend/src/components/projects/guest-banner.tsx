'use client';

import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';

/**
 * Shown while working without an account.
 *
 * A guest session is a real Supabase identity kept in this browser's storage,
 * so the work is genuinely saved — but only here, and only until the browser
 * data is cleared. Creating an account upgrades that same identity in place,
 * so nothing is migrated and nothing is lost.
 */
export function GuestBanner() {
  const { isGuest, createAccountFromGuest } = useAuth();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isGuest) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createAccountFromGuest(email, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mb-8 rounded-2xl bg-[var(--surface-container-low)] px-6 py-4">
        <p className="text-body text-[var(--on-surface)]">
          Account created — check your email to confirm it. Everything you have made so far is
          already attached to it.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-2xl bg-[var(--surface-container-low)] px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-title text-[var(--on-surface)]">You are working as a guest</p>
          <p className="mt-1 max-w-[62ch] text-body text-[var(--on-surface-variant)]">
            Your projects are saved, but only in this browser. Create an account to reach them
            from anywhere — everything you have made so far comes with you.
          </p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
          >
            Create an account
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none"
            />
          </label>
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
              Password
            </span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-2.5 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            Not now
          </button>

          {error && (
            <p className="w-full text-body text-[var(--pm-error)]">{error}</p>
          )}
        </form>
      )}
    </div>
  );
}
