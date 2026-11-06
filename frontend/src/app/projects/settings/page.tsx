'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useConnectionsAllowed } from '@/components/personalize/use-connections-allowed';
import { useAuth } from '@/hooks/use-auth';
import { disconnectGoogle, forgetGoogle } from '@/lib/connections/google';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { createClient } from '@/lib/supabase/client';
import { loadPreferences, savePreferences, type UserPreferences } from '@/lib/supabase/preferences';

/**
 * What this person chose to share, and the way to take it back (the client's call,
 * 4 Nov: "explain permissions clearly and keep connections optional").
 */
export default function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const allowed = useConnectionsAllowed();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [holding, setHolding] = useState<{ id: string; title: string }[]>([]);
  const [note, setNote] = useState<{ text: string; link?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadPreferences(userId).then((p) => live && setPreferences(p)).catch(() => undefined);
    // Not the material itself: only which projects hold any.
    createClient()
      .from('projects')
      .select('id, title')
      .is('deleted_at', null)
      .neq('third_party', '[]')
      .then(({ data }: { data: { id: string; title: string }[] | null }) => {
        if (live) setHolding(data ?? []);
      });
    return () => {
      live = false;
    };
  }, [userId]);

  async function disconnect() {
    if (!userId || busy) return;
    setBusy(true);
    setNote(null);
    let reached = true;
    try {
      await disconnectGoogle();
    } catch {
      // Without a live token Google cannot be told. The record still goes, and they are shown where to finish.
      reached = false;
      forgetGoogle();
    }
    const connections = { ...preferences?.connections };
    delete connections.google;
    await savePreferences(userId, { connections, personalization: 'unset' }).catch(() => undefined);
    setPreferences((p) => (p ? { ...p, connections, personalization: 'unset' } : p));
    setNote(reached ? { text: t('settings.disconnected') } : { text: t('settings.disconnectFailed'), link: true });
    setBusy(false);
  }

  async function clearAnswers() {
    if (!userId) return;
    await savePreferences(userId, { questionnaire: {} }).catch(() => undefined);
    setPreferences((p) => (p ? { ...p, questionnaire: {} } : p));
  }

  const google = preferences?.connections?.google;
  const answers = Object.values(preferences?.questionnaire ?? {}).filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-display text-[var(--on-surface)]">{t('settings.title')}</h1>

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('settings.connections')}</h2>
        {google ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
            <p className="text-body text-[var(--on-surface)]">{t('settings.connectedOn', { date: new Date(google.connected_at).toLocaleDateString(locale) })}</p>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
            >
              {t('settings.disconnect')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('settings.notConnected')}</p>
        )}
        {note && (
          <p role="status" className="mt-2 text-body text-[var(--on-surface)]">
            {note.text}{' '}
            {note.link && (
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="font-medium text-[var(--pm-primary)] hover:underline">
                {t('settings.googlePermissions')}
              </a>
            )}
          </p>
        )}
        {allowed && !google && (
          <Link href="/projects/connect" className="mt-3 inline-block text-body font-medium text-[var(--pm-primary)] hover:underline">{t('settings.connect')}</Link>
        )}
      </section>

      {holding.length > 0 && (
        <section className="mt-8">
          <h2 className="text-headline text-[var(--on-surface)]">{t('settings.holding')}</h2>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('settings.holdingNote')}</p>
          <ul className="mt-3 space-y-1.5">
            {holding.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="text-body font-medium text-[var(--pm-primary)] hover:underline">{p.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('settings.answers')}</h2>
        {answers.length > 0 ? (
          <button type="button" onClick={() => void clearAnswers()} className="mt-2 text-body font-medium text-[var(--pm-primary)] hover:underline">{t('settings.clearAnswers')}</button>
        ) : (
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('settings.noAnswers')}</p>
        )}
      </section>

      <p className="mt-10 text-label text-[var(--on-surface-variant)]">
        <Link href="/privacy" className="hover:underline">{t('legal.privacy')}</Link>
        {' · '}
        <Link href="/terms" className="hover:underline">{t('legal.terms')}</Link>
      </p>
    </main>
  );
}
