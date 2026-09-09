'use client';

/**
 * FR-19: the operations page.
 *
 * **This page holds no privilege whatsoever.** It is an ordinary client
 * component that sends the user's access token to `/api/admin/overview` and
 * renders whatever comes back. There is deliberately no `if (isAdmin)` here and
 * no import of `lib/admin/access` — a client-side gate over a service-role
 * query is the exact shape of a data breach, and a client-side gate over an
 * RLS-scoped query is decoration. The refusal happens in the route handler,
 * where the data is.
 *
 * So a non-admin who navigates here does not see a blank page or a redirect
 * loop: they see the 403 the server sent, in words. That is better than hiding
 * the route, because a real admin whose id was never added to the allowlist
 * gets told exactly what is wrong instead of assuming the page is broken.
 */

import { useCallback, useEffect, useState } from 'react';

import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { createClient } from '@/lib/supabase/client';
import type { AdminOverview } from '@/lib/admin/types';

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; overview: AdminOverview }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string };

export default function AdminPage() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [windowDays, setWindowDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (days: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setStatus({ kind: 'loading' });

      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setStatus({ kind: 'denied', message: 'Sign in to view this page.' });
          return;
        }

        const res = await fetch(`/api/admin/overview?days=${days}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        if (res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => null);
          setStatus({
            kind: 'denied',
            message: body?.error ?? 'This page is limited to administrators.',
          });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setStatus({
            kind: 'error',
            message: body?.error ?? `The operations data could not be loaded (${res.status}).`,
          });
          return;
        }

        setStatus({ kind: 'ready', overview: (await res.json()) as AdminOverview });
      } catch (error) {
        setStatus({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The operations data could not be loaded.',
        });
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(windowDays);
  }, [load, windowDays]);

  return (
    <main className="min-h-screen bg-[var(--surface)] px-6 py-10">
      <div className="mx-auto max-w-[1100px]">
        {status.kind === 'loading' && <Placeholder />}

        {status.kind === 'denied' && (
          <Notice
            icon="lock"
            title="Not available on this account"
            body={status.message}
            hint="If this is unexpected, the account's user id needs adding to ADMIN_USER_IDS on the deployment."
          />
        )}

        {status.kind === 'error' && (
          <Notice
            icon="error"
            title="The operations data could not be loaded"
            body={status.message}
            action={{ label: 'Try again', onClick: () => void load(windowDays) }}
          />
        )}

        {status.kind === 'ready' && (
          <AdminDashboard
            overview={status.overview}
            onWindowChange={setWindowDays}
            refreshing={refreshing}
            onRefresh={() => void load(windowDays, true)}
          />
        )}
      </div>
    </main>
  );
}

function Placeholder() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-[var(--surface-container-high)]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl bg-[var(--surface-container-low)]"
          />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl bg-[var(--surface-container-low)]" />
      <span className="sr-only">Loading operations data</span>
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
  hint,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="alert"
      className="mx-auto max-w-[46rem] rounded-xl bg-[var(--surface-container-low)] px-6 py-6 shadow-ambient"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-[var(--on-surface-variant)]"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="text-title text-[var(--on-surface)]">{title}</h1>
          <p className="mt-1 max-w-[68ch] text-body text-[var(--on-surface-variant)]">
            {body}
          </p>
          {hint && (
            <p className="mt-2 max-w-[68ch] text-label text-[var(--on-surface-variant)]">
              {hint}
            </p>
          )}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-4 rounded-full bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] transition-opacity hover:opacity-90"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
