'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { ToolkitLogo } from '@/components/personalize/toolkit-logo';
import { useAuth } from '@/hooks/use-auth';
import { forgetConnectedAccount } from '@/lib/connections/account-found';
import { api } from '@/lib/api/client';
import { CONNECT_PATH, TOOLKITS, rememberReturn, type Connection, type ToolkitSlug } from '@/lib/connections/items';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';

/**
 * Each account PromptMaster can connect, with what it reads and a way to connect
 * or disconnect it (the client's call, 7 Nov). Connecting goes to Composio's link
 * and on to Google's or Microsoft's own screen, then back through `/projects/connect`
 * to `returnTo`. Disconnecting withdraws the grant there too.
 */
export function ConnectedAccounts({
  returnTo,
  onLoaded,
}: {
  returnTo: string;
  onLoaded?: (accounts: Connection[]) => void;
}) {
  const t = useT();
  const { user, isGuest, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // A parent may pass a new function each render; the list loads once, not each time.
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { accounts: found } = await api.listConnections();
      setAccounts(found);
      loaded.current?.(found);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (/not set up/i.test(message)) setNotSetUp(true);
      else setError(t('conn.loadFailed', { why: message }));
      setAccounts([]);
      loaded.current?.([]);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || !user || isGuest) return;
    void load();
  }, [authLoading, user, isGuest, load]);

  async function connect(slug: ToolkitSlug) {
    setBusy(slug);
    setError(null);
    try {
      const { redirect_url } = await api.linkConnection(slug, `${window.location.origin}${CONNECT_PATH}`);
      rememberReturn(returnTo);
      window.location.assign(redirect_url);
    } catch (e) {
      setError(t('conn.failed', { why: e instanceof Error ? e.message : '' }));
      setBusy(null);
    }
  }

  async function disconnect(connection: Connection) {
    setBusy(connection.id);
    setError(null);
    try {
      await api.disconnect(connection.id);
      forgetConnectedAccount();
      await load();
    } catch (e) {
      setError(t('conn.failed', { why: e instanceof Error ? e.message : '' }));
    } finally {
      setBusy(null);
    }
  }

  if (authLoading) return null;

  if (!user || isGuest) {
    return (
      <div className="rounded-2xl bg-[var(--surface-container-low)] p-5">
        <p className="text-body text-[var(--on-surface)]">{t('conn.guest')}</p>
        <Link
          href={`/auth/signup?next=${encodeURIComponent(returnTo)}`}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          {t('conn.guestAction')}
        </Link>
      </div>
    );
  }

  if (notSetUp) {
    return <p className="rounded-2xl bg-[var(--surface-container-low)] p-5 text-body text-[var(--on-surface-variant)]">{t('conn.notSetUp')}</p>;
  }

  return (
    <div>
      <ul className="space-y-2" aria-busy={accounts === null}>
        {TOOLKITS.map((toolkit) => {
          const held = accounts?.find((a) => a.toolkit === toolkit.slug);
          const active = held?.status === 'ACTIVE';
          return (
            <li key={toolkit.slug} className="flex flex-wrap items-start gap-3 rounded-xl bg-[var(--surface-container-low)] p-4">
              <ToolkitLogo slug={toolkit.slug} size={24} className="mt-0.5 text-[var(--pm-primary)]" />
              <div className="min-w-0 flex-1">
                <p className="text-title text-[var(--on-surface)]">
                  {toolkit.label}
                  {held && (
                    <span className={`ms-2 text-label font-medium ${active ? 'text-[var(--pm-primary)]' : 'text-[var(--pm-error)]'}`}>
                      {active ? t('conn.connected') : t('conn.expired')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{t(`conn.reads.${toolkit.slug}` as MessageKey)}</p>
              </div>
              {accounts !== null &&
                (active ? (
                  <button
                    type="button"
                    onClick={() => void disconnect(held)}
                    disabled={busy !== null}
                    className="shrink-0 rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label font-medium text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
                  >
                    {busy === held.id ? t('conn.disconnecting') : t('conn.disconnect')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void connect(toolkit.slug)}
                    disabled={busy !== null}
                    className="shrink-0 rounded-lg bg-[var(--pm-primary)] px-3 py-2 text-label font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === toolkit.slug ? t('conn.opening') : held ? t('conn.reconnect') : t('conn.connect')}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-label text-[var(--on-surface-variant)]">{t('conn.disconnectNote')}</p>
      <p className="mt-3 text-label text-[var(--on-surface-variant)]">{t('conn.crmNote')}</p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--pm-error)]">{error}</p>
      )}
    </div>
  );
}
