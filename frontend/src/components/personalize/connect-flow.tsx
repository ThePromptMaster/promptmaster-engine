'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api/client';
import { setRequestLanguage } from '@/lib/api/language';
import { goSignedIn } from '@/lib/auth/sign-in';
import {
  MAX_TICKED,
  itemKey,
  relatedTo,
  shortWhen,
  toPicked,
  toSharedItems,
  toThirdParty,
  type ConnectedText,
  type Connection,
  type PreviewItem,
  type Skipped,
  toolkitLabel,
} from '@/lib/connections/items';
import { fileToText } from '@/lib/connections/read-file';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { getLocale } from '@/lib/i18n/store';
import { EXAMPLES } from '@/lib/projects/examples';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';
import { startExample } from '@/lib/projects/examples/start-example';
import { rememberStartGoal } from '@/lib/projects/example-goals';
import { startLanguage } from '@/lib/workflow/languages';

import { ConnectedAccounts } from './connected-accounts';

type Phase = 'idle' | 'looking' | 'pick' | 'reading' | 'review' | 'suggesting' | 'suggestions' | 'starting';

interface Suggestion {
  example_key: string;
  title: string;
  why: string;
  objective: string;
  based_on: number[];
}

const primary =
  'inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40';
const secondary =
  'inline-flex items-center gap-2 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-title text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40';

function isText(x: ConnectedText | Skipped): x is ConnectedText {
  return 'text' in x;
}

/**
 * The person's own mail, meetings and files, used only as far as they choose
 * (the client's call, 7 Nov). Every step is a press, and nothing happens behind one:
 *
 * 1. "Show what's there" lists titles, senders and dates. No contents, no model.
 * 2. They tick, nothing ticked to start with; or press "Brief me for this" on a
 *    meeting, which ticks it and the emails around it.
 * 3. "Read what I ticked" fetches only those, and shows the exact text, which they
 *    may change or remove. What is sent is what is shown.
 * 4. Suggestions (one model call), or a briefing project holding the text as other
 *    people's words, with web search off.
 */
export function ConnectFlow({ briefing = false }: { briefing?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Connection[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<ConnectedText[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [meeting, setMeeting] = useState<PreviewItem | null>(null);
  const [result, setResult] = useState<{ work_summary: string; suggestions: Suggestion[] } | null>(null);
  const [sentTitles, setSentTitles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const active = (accounts ?? []).filter((a) => a.status === 'ACTIVE');
  const full = ticked.size >= MAX_TICKED;
  const why = (e: unknown) => t('conn.failed', { why: e instanceof Error ? e.message : '' });

  async function look() {
    setPhase('looking');
    setError(null);
    try {
      const found = await api.previewConnections();
      setItems(found.items);
      setProblems(found.problems.map((p) => `${toolkitLabel(p.toolkit)}: ${p.message}`));
      setTicked(new Set());
      setPhase('pick');
    } catch (e) {
      setError(why(e));
      setPhase('idle');
    }
  }

  function toggle(item: PreviewItem) {
    const key = itemKey(item);
    setTicked((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_TICKED) next.add(key);
      return next;
    });
  }

  async function read(keys: Set<string>, forMeeting: PreviewItem | null) {
    setPhase('reading');
    setError(null);
    setMeeting(forMeeting);
    try {
      const picked = items.filter((i) => keys.has(itemKey(i)) && i.readable);
      const back = await api.readConnections(picked.map(toPicked));
      const fromFiles = await Promise.all(back.files.map((f) => fileToText(f, t('conn.fileUnread'))));
      const texts = [...back.items, ...fromFiles.filter(isText)];
      // In the order they were listed, so the meeting leads a briefing.
      const order = new Map(picked.map((p, i) => [itemKey(p), i]));
      texts.sort((a, b) => (order.get(itemKey(a)) ?? 0) - (order.get(itemKey(b)) ?? 0));
      setChosen(texts);
      setSkipped([...back.skipped, ...fromFiles.filter((x): x is Skipped => !isText(x))]);
      setPhase('review');
    } catch (e) {
      setError(why(e));
      setPhase('pick');
    }
  }

  function briefMe(item: PreviewItem) {
    const keys = new Set([itemKey(item), ...relatedTo(item, items, user?.email ?? '').map(itemKey)]);
    setTicked(keys);
    void read(keys, item);
  }

  async function suggest() {
    setPhase('suggesting');
    setError(null);
    setRequestLanguage(startLanguage(getLocale()));
    try {
      const back = await api.suggestWorkflows({
        items: toSharedItems(chosen),
        catalog: EXAMPLE_CARDS.map((c) => ({
          key: c.key,
          title: t(`ex.${c.key}.title` as MessageKey),
          description: t(`ex.${c.key}.blurb` as MessageKey).slice(0, 400),
        })),
      });
      setSentTitles(chosen.map((c) => c.title));
      setResult(back);
      setPhase('suggestions');
    } catch (e) {
      setError(why(e));
      setPhase('review');
    } finally {
      setRequestLanguage('en');
    }
  }

  async function startBriefing() {
    const example = EXAMPLES.find((e) => e.key === 'meeting_briefing');
    if (!meeting || !example || !user) return;
    setPhase('starting');
    setError(null);
    try {
      const title = meeting.title.length <= 60 ? meeting.title : `${meeting.title.slice(0, 57).trimEnd()}…`;
      const id = await startExample(example, user.id, {
        language: startLanguage(getLocale()),
        own: {
          title,
          objective: t('conn.briefingObjective', { title: meeting.title, when: shortWhen(meeting.when, locale) }),
          context: '',
          files: [],
          images: [],
          third_party: toThirdParty(chosen),
        },
      });
      goSignedIn(`/projects/${id}`);
    } catch (e) {
      setError(why(e));
      setPhase('review');
    }
  }

  function startFrom(s: Suggestion) {
    rememberStartGoal(s.objective);
    goSignedIn('/projects/new');
  }

  const returnTo = briefing ? '/projects/from-accounts?for=briefing' : '/projects/from-accounts';

  const section = (heading: string, kind: PreviewItem['kind']) => {
    const rows = items.filter((i) => i.kind === kind);
    return (
      <section className="mt-5">
        <h2 className="text-title text-[var(--on-surface)]">{heading}</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('conn.nothing')}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {rows.map((item) => {
              const key = itemKey(item);
              const on = ticked.has(key);
              const sub = [item.who, shortWhen(item.when, locale), toolkitLabel(item.toolkit)].filter(Boolean).join(' · ');
              return (
                <li key={key} className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
                  <input
                    id={`item-${key}`}
                    type="checkbox"
                    checked={on}
                    disabled={!item.readable || (!on && full)}
                    onChange={() => toggle(item)}
                    className="mt-1"
                  />
                  <label htmlFor={`item-${key}`} className="min-w-0 flex-1 cursor-pointer">
                    <span dir="auto" className="block truncate text-body text-[var(--on-surface)]">{item.title}</span>
                    <span dir="auto" className="block truncate text-label text-[var(--on-surface-variant)]">{sub}</span>
                    {!item.readable && <span className="block text-label text-[var(--on-surface-variant)]">{item.note || t('conn.fileUnread')}</span>}
                  </label>
                  {kind === 'calendar_event' && (
                    <button
                      type="button"
                      onClick={() => briefMe(item)}
                      className="shrink-0 rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
                    >
                      {t('conn.brief')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-display text-[var(--on-surface)]">{briefing ? t('conn.entryBriefing') : t('conn.flowTitle')}</h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">{t('conn.flowLead')}</p>

      {(accounts === null || active.length === 0) && (
        <section className="mt-6">
          {accounts !== null && <p className="mb-3 text-title text-[var(--on-surface)]">{t('conn.noneConnected')}</p>}
          <p className="mb-3 text-label text-[var(--on-surface-variant)]">{t('conn.composioNote')}</p>
          <ConnectedAccounts returnTo={returnTo} onLoaded={setAccounts} />
        </section>
      )}

      {active.length > 0 && (phase === 'idle' || phase === 'looking') && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => void look()} disabled={phase === 'looking'} className={primary}>
            {phase === 'looking' ? t('conn.looking') : t('conn.look')}
          </button>
          <Link href="/projects/settings" className="text-label font-medium text-[var(--pm-primary)] hover:underline">{t('conn.manage')}</Link>
        </div>
      )}

      {(phase === 'pick' || phase === 'reading') && (
        <>
          {problems.map((p) => (
            <p key={p} role="status" className="mt-3 text-label text-[var(--on-surface-variant)]">{p}</p>
          ))}
          {section(t('conn.meetings'), 'calendar_event')}
          {section(t('conn.mail'), 'email')}
          {section(t('conn.files'), 'file')}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" disabled={ticked.size === 0 || phase === 'reading'} onClick={() => void read(ticked, null)} className={primary}>
              {phase === 'reading' ? t('conn.reading') : t('conn.read')}
            </button>
            <span role="status" className="text-label text-[var(--on-surface-variant)]">
              {t('conn.ticked', { count: ticked.size })}
              {full ? ` ${t('conn.tickMax', { max: MAX_TICKED })}` : ''}
            </span>
          </div>
        </>
      )}

      {(phase === 'review' || phase === 'suggesting' || phase === 'starting') && (
        <>
          <h2 className="mt-6 text-headline text-[var(--on-surface)]">{t('conn.reviewTitle')}</h2>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('conn.reviewLead')}</p>
          <ol className="mt-5 space-y-3">
            {chosen.map((item) => (
              <li key={itemKey(item)} className="rounded-xl bg-[var(--surface-container-low)] p-4">
                <div className="flex items-start gap-2">
                  <p dir="auto" className="min-w-0 flex-1 text-title text-[var(--on-surface)]">{item.title}</p>
                  <button
                    type="button"
                    onClick={() => setChosen((held) => held.filter((c) => itemKey(c) !== itemKey(item)))}
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
                  onChange={(e) => setChosen((held) => held.map((c) => (itemKey(c) === itemKey(item) ? { ...c, text: e.target.value } : c)))}
                  rows={Math.min(10, Math.max(3, item.text.split('\n').length + 1))}
                  className="mt-2 w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-label text-[var(--on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]"
                />
              </li>
            ))}
          </ol>
          {skipped.length > 0 && (
            <section className="mt-5">
              <h3 className="text-title text-[var(--on-surface)]">{t('conn.skippedTitle')}</h3>
              <ul className="mt-2 space-y-1">
                {skipped.map((s) => (
                  <li key={`${s.id}-${s.reason}`} dir="auto" className="text-label text-[var(--on-surface-variant)]">
                    {s.title ? `${s.title}: ` : ''}
                    {s.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {meeting && <p className="mt-5 text-label text-[var(--on-surface-variant)]">{t('conn.webOff')}</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            {meeting ? (
              <button type="button" onClick={() => void startBriefing()} disabled={!chosen.length || phase !== 'review'} className={primary}>
                {phase === 'starting' ? t('conn.starting') : t('conn.startBriefing')}
              </button>
            ) : (
              <button type="button" onClick={() => void suggest()} disabled={!chosen.length || phase !== 'review'} className={primary}>
                {phase === 'suggesting' ? t('conn.suggesting') : t('conn.suggest')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMeeting(null);
                setPhase('pick');
              }}
              disabled={phase !== 'review'}
              className={secondary}
            >
              {t('conn.back')}
            </button>
          </div>
        </>
      )}

      {phase === 'suggestions' && result && (
        <>
          <h2 className="mt-6 text-headline text-[var(--on-surface)]">{t('conn.suggestTitle')}</h2>
          {result.work_summary && <p dir="auto" className="mt-2 text-body text-[var(--on-surface-variant)]">{result.work_summary}</p>}
          {result.suggestions.length === 0 ? (
            <p className="mt-4 text-body text-[var(--on-surface)]">{t('conn.noSuggestions')}</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {result.suggestions.map((s) => {
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
          <button type="button" onClick={() => setPhase('review')} className={`mt-5 ${secondary}`}>{t('conn.back')}</button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--pm-error)]">{error}</p>
      )}
    </main>
  );
}
