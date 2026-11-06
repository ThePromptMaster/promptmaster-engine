'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ExampleQuestionnaire } from '@/components/examples/example-questionnaire';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api/client';
import {
  GoogleRefused,
  connectGoogle,
  googleConfigured,
  pickGoogleFiles,
  readGoogleCalendar,
  readGoogleMail,
} from '@/lib/connections/google';
import { MAX_TICKED, toThirdParty, type ConnectedItem } from '@/lib/connections/items';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';
import { rememberStartGoal } from '@/lib/projects/example-goals';
import { savePreferences } from '@/lib/supabase/preferences';

type Step = 'consent' | 'reading' | 'pick' | 'preview' | 'sending' | 'suggestions' | 'declined';

interface Suggestion {
  example_key: string;
  title: string;
  why: string;
  objective: string;
  based_on: number[];
}

const primary = 'inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40';
const secondary = 'inline-flex items-center gap-2 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-title text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40';

function ConsentLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-label font-semibold text-[var(--on-surface)]">{title}</p>
      <p className="mt-0.5 text-body text-[var(--on-surface-variant)]">{children}</p>
    </div>
  );
}

function ItemRows({
  items,
  ticked,
  full,
  onToggle,
  extra,
}: {
  items: readonly ConnectedItem[];
  ticked: ReadonlySet<string>;
  full: boolean;
  onToggle: (id: string) => void;
  extra?: (item: ConnectedItem) => React.ReactNode;
}) {
  const t = useT();
  if (!items.length) return <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('conn.none')}</p>;
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
          <input
            id={`item-${item.id}`}
            type="checkbox"
            checked={ticked.has(item.id)}
            disabled={!ticked.has(item.id) && full}
            onChange={() => onToggle(item.id)}
            className="mt-1"
          />
          <label htmlFor={`item-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
            <span dir="auto" className="block truncate text-body text-[var(--on-surface)]">{item.title}</span>
            <span dir="auto" className="block truncate text-label text-[var(--on-surface-variant)]">{item.source}</span>
          </label>
          {extra?.(item)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Connecting an account, one step at a time, and nothing happens behind a step.
 *
 * Consent says what happens before Google's own screen does. The list starts with
 * nothing ticked, and everything so far has stayed in this tab. The preview shows the
 * exact text that will leave, editable line by line, and what is sent is what is shown
 * (`toThirdParty(chosen)`, tested). A person who would rather not gets the questions.
 */
export function ConnectFlow({ onBriefing }: { onBriefing?: (meeting: ConnectedItem, ticked: ConnectedItem[]) => void }) {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('consent');
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ConnectedItem[]>([]);
  const [mail, setMail] = useState<ConnectedItem[]>([]);
  const [files, setFiles] = useState<ConnectedItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<ConnectedItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [summary, setSummary] = useState('');
  const [sentTitles, setSentTitles] = useState<string[]>([]);

  const all = [...events, ...mail, ...files];
  const full = ticked.size >= MAX_TICKED;

  function record(update: Parameters<typeof savePreferences>[1]) {
    if (user) void savePreferences(user.id, update).catch(() => undefined);
  }

  async function connect() {
    setError(null);
    setStep('reading');
    try {
      await connectGoogle();
    } catch (e) {
      setError(e instanceof GoogleRefused ? t('conn.refused') : t('conn.readFailed', { what: 'Google', why: e instanceof Error ? e.message : '' }));
      setStep('declined');
      return;
    }
    record({ personalization: 'connected', connections: { google: { connected_at: new Date().toISOString() } } });
    // Each on its own: someone may have allowed one and not the other.
    const said: string[] = [];
    const read = async (what: string, work: () => Promise<ConnectedItem[]>) => {
      try {
        return await work();
      } catch (e) {
        said.push(t('conn.readFailed', { what, why: e instanceof Error ? e.message : '' }));
        return [];
      }
    };
    const [calendar, recent] = await Promise.all([
      read(t('conn.calendar'), () => readGoogleCalendar()),
      read(t('conn.mail'), () => readGoogleMail()),
    ]);
    setEvents(calendar);
    setMail(recent);
    setNotes(said);
    setStep('pick');
  }

  async function pickFiles() {
    setError(null);
    try {
      const picked = await pickGoogleFiles();
      setFiles((held) => [...held, ...picked.filter((p) => !held.some((h) => h.id === p.id))]);
    } catch (e) {
      setError(t('conn.readFailed', { what: t('conn.files'), why: e instanceof Error ? e.message : '' }));
    }
  }

  function toggle(id: string) {
    setTicked((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_TICKED) next.add(id);
      return next;
    });
  }

  async function send() {
    setError(null);
    setStep('sending');
    try {
      const catalog = EXAMPLE_CARDS.map((c) => ({
        key: c.key,
        title: t(`ex.${c.key}.title` as MessageKey),
        description: t(`ex.${c.key}.blurb` as MessageKey),
      }));
      const result = await api.suggestWorkflows({ items: toThirdParty(chosen), catalog });
      setSentTitles(chosen.map((c) => c.title));
      setSummary(result.work_summary);
      setSuggestions(result.suggestions);
      setStep('suggestions');
    } catch (e) {
      setError(t('conn.sendFailed', { why: e instanceof Error ? e.message : '' }));
      setStep('preview');
    }
  }

  function startFrom(suggestion: Suggestion) {
    rememberStartGoal(suggestion.objective);
    router.push('/projects/new');
  }

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      {children}
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--pm-error)]">{error}</p>
      )}
    </main>
  );

  if (step === 'declined') {
    return shell(
      <>
        <h1 className="text-display text-[var(--on-surface)]">{t('conn.title')}</h1>
        <div className="mt-6">
          <ExampleQuestionnaire startOpen />
        </div>
      </>
    );
  }

  if (step === 'consent' || step === 'reading') {
    return shell(
      <>
        <h1 className="text-display text-[var(--on-surface)]">{t('conn.title')}</h1>
        <p className="mt-3 text-body text-[var(--on-surface-variant)]">{t('conn.lead')}</p>
        <section className="mt-6 space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-5">
          <ConsentLine title={t('conn.readsTitle')}>{t('conn.readsGoogle')}</ConsentLine>
          <ConsentLine title={t('conn.neverTitle')}>{t('conn.never')}</ConsentLine>
          <ConsentLine title={t('conn.whereTitle')}>{t('conn.where')}</ConsentLine>
          <ConsentLine title={t('conn.savedTitle')}>{t('conn.saved')}</ConsentLine>
          <ConsentLine title={t('conn.stopTitle')}>{t('conn.stop')}</ConsentLine>
          <p className="text-label text-[var(--on-surface-variant)]">{t('conn.unverified')}</p>
          <Link href="/privacy" className="inline-block text-label font-medium text-[var(--pm-primary)] hover:underline">{t('conn.privacy')}</Link>
        </section>
        <div className="mt-5 flex flex-wrap gap-3">
          {googleConfigured() && (
            <button type="button" onClick={() => void connect()} disabled={step === 'reading'} className={primary}>
              {step === 'reading' ? t('conn.connecting') : t('conn.google')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              record({ personalization: 'declined' });
              setStep('declined');
            }}
            className={secondary}
          >
            {t('conn.decline')}
          </button>
        </div>
      </>
    );
  }

  if (step === 'pick') {
    return shell(
      <>
        <h1 className="text-headline text-[var(--on-surface)]">{t('conn.tickLead')}</h1>
        {notes.map((note) => (
          <p key={note} role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">{note}</p>
        ))}
        <section className="mt-5">
          <h2 className="text-title text-[var(--on-surface)]">{t('conn.calendar')}</h2>
          <ItemRows
            items={events}
            ticked={ticked}
            full={full}
            onToggle={toggle}
            extra={
              onBriefing
                ? (item) => (
                    <button
                      type="button"
                      onClick={() => onBriefing(item, all.filter((i) => ticked.has(i.id) && i.id !== item.id))}
                      className="shrink-0 rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
                    >
                      {t('conn.brief')}
                    </button>
                  )
                : undefined
            }
          />
        </section>
        <section className="mt-5">
          <h2 className="text-title text-[var(--on-surface)]">{t('conn.mail')}</h2>
          <ItemRows items={mail} ticked={ticked} full={full} onToggle={toggle} />
        </section>
        <section className="mt-5">
          <h2 className="text-title text-[var(--on-surface)]">{t('conn.files')}</h2>
          {files.length > 0 && <ItemRows items={files} ticked={ticked} full={full} onToggle={toggle} />}
          <button type="button" onClick={() => void pickFiles()} className="mt-2 inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline">
            <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
            {t('conn.pickFiles')}
          </button>
        </section>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={ticked.size === 0}
            onClick={() => {
              setChosen(all.filter((i) => ticked.has(i.id)));
              setStep('preview');
            }}
            className={primary}
          >
            {t('conn.review')}
          </button>
          <span role="status" className="text-label text-[var(--on-surface-variant)]">
            {t('conn.tickedCount', { count: ticked.size })}
            {full ? ` ${t('conn.tickMax', { max: MAX_TICKED })}` : ''}
          </span>
        </div>
      </>
    );
  }

  if (step === 'preview' || step === 'sending') {
    return shell(
      <>
        <h1 className="text-headline text-[var(--on-surface)]">{t('conn.previewTitle')}</h1>
        <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('conn.previewLead')}</p>
        <ol className="mt-5 space-y-3">
          {chosen.map((item) => (
            <li key={item.id} className="rounded-xl bg-[var(--surface-container-low)] p-4">
              <div className="flex items-start gap-2">
                <p dir="auto" className="min-w-0 flex-1 text-title text-[var(--on-surface)]">{item.title}</p>
                <button
                  type="button"
                  onClick={() => setChosen((held) => held.filter((c) => c.id !== item.id))}
                  className="shrink-0 text-label font-medium text-[var(--pm-primary)] hover:underline"
                >
                  {t('conn.remove')}
                </button>
              </div>
              <p dir="auto" className="text-label text-[var(--on-surface-variant)]">{item.source}</p>
              <textarea
                dir="auto"
                aria-label={item.title}
                value={item.text}
                onChange={(e) => setChosen((held) => held.map((c) => (c.id === item.id ? { ...c, text: e.target.value } : c)))}
                rows={Math.min(8, Math.max(2, item.text.split('\n').length + 1))}
                className="mt-2 w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-label text-[var(--on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]"
              />
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={() => void send()} disabled={!chosen.length || step === 'sending'} className={primary}>
            {step === 'sending' ? t('conn.sending') : t('conn.send')}
          </button>
          <button type="button" onClick={() => setStep('pick')} disabled={step === 'sending'} className={secondary}>{t('conn.back')}</button>
        </div>
      </>
    );
  }

  return shell(
    <>
      <h1 className="text-headline text-[var(--on-surface)]">{t('conn.suggestTitle')}</h1>
      {summary && <p dir="auto" className="mt-2 text-body text-[var(--on-surface-variant)]">{summary}</p>}
      {suggestions.length === 0 ? (
        <p className="mt-4 text-body text-[var(--on-surface)]">{t('conn.noSuggestions')}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {suggestions.map((s) => {
            const card = EXAMPLE_CARDS.find((c) => c.key === s.example_key);
            return (
              <li key={s.title} className="rounded-xl bg-[var(--surface-container-low)] p-4">
                <p dir="auto" className="text-title text-[var(--on-surface)]">{s.title}</p>
                {s.why && <p dir="auto" className="mt-1 text-body text-[var(--on-surface-variant)]">{s.why}</p>}
                <p dir="auto" className="mt-1 text-label text-[var(--on-surface-variant)]">
                  {t('conn.basedOn', { titles: s.based_on.map((n) => sentTitles[n - 1]).filter(Boolean).join(', ') })}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => startFrom(s)} className={secondary}>{t('conn.startThis')}</button>
                  {card && (
                    <Link href={exampleHref(card.slug)} className="text-label font-medium text-[var(--pm-primary)] hover:underline">{t('conn.seeExample')}</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => setStep('pick')} className={`mt-5 ${secondary}`}>{t('conn.back')}</button>
    </>
  );
}
