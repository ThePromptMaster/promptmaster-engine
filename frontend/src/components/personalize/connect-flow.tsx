'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { ToolkitLogo } from '@/components/personalize/toolkit-logo';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api/client';
import { setRequestLanguage } from '@/lib/api/language';
import { goSignedIn } from '@/lib/auth/sign-in';
import {
  MAX_HELD,
  itemKey,
  mergeThirdParty,
  rememberStartItems,
  shortWhen,
  toPicked,
  toSharedItems,
  toThirdParty,
  type ConnectedText,
  type Connection,
  type PreviewItem,
  type Skipped,
  type ToolkitSlug,
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
import { getProject, updateProject } from '@/lib/supabase/projects';
import { startLanguage } from '@/lib/workflow/languages';
import { ProjectConflictError } from '@/types/project';

import { ConnectedAccounts } from './connected-accounts';

type Phase = 'idle' | 'searching' | 'found' | 'suggesting' | 'suggestions' | 'starting';

interface Suggestion {
  example_key: string;
  title: string;
  why: string;
  objective: string;
  based_on: number[];
}

const MAX_MEETINGS = 8;
const CALENDARS: readonly ToolkitSlug[] = ['googlecalendar', 'outlook'];
/** The backend's `MAX_ATTENDEES`. */
const MAX_PEOPLE = 20;

const primary =
  'inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40';
const secondary =
  'inline-flex items-center gap-2 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-title text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40';

function isText(x: ConnectedText | Skipped): x is ConnectedText {
  return 'text' in x;
}

/**
 * The person's own mail, meetings and files (8 Nov: "it should just search
 * everything"). One box, and nothing to tick:
 *
 * 1. They say what they are after, or leave it empty for what is going on now. The
 *    backend searches the whole of every connected account and reads the best matches.
 * 2. Straight on to suggestions, with what was read listed beside them to see or remove.
 * 3. "Brief me for this" on a meeting searches for it and starts the project at once.
 *
 * What was read is other people's words: fenced in every prompt, and a web search
 * there is written from the person's own words only (L-200).
 *
 * `into`: opened from a project's "From your accounts" panel, what was found is added
 * to that project on one press, up to what it has room for.
 */
export function ConnectFlow({ briefing = false, into }: { briefing?: boolean; into?: string }) {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Connection[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [words, setWords] = useState('');
  const [meetings, setMeetings] = useState<PreviewItem[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [chosen, setChosen] = useState<ConnectedText[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [searched, setSearched] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<PreviewItem | null>(null);
  const [result, setResult] = useState<{ work_summary: string; suggestions: Suggestion[] } | null>(null);
  // What the suggestions were made from, as sent: "based on" points into it.
  const [sent, setSent] = useState<ConnectedText[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The project the items go into, when opened from one.
  // Translated at render: an effect that used `t` would run again on every language change.
  const [target, setTarget] = useState<{ title: string; held: number } | { gone: true } | { failed: string } | null>(null);

  useEffect(() => {
    if (!into) return;
    let live = true;
    getProject(into)
      .then((p) => live && setTarget(p ? { title: p.title, held: p.third_party?.length ?? 0 } : { gone: true }))
      .catch((e: unknown) => live && setTarget({ failed: e instanceof Error ? e.message : '' }));
    return () => {
      live = false;
    };
  }, [into]);
  const project = target && 'title' in target ? target : null;
  const targetProblem = !target ? null : 'gone' in target ? t('conn.intoGone') : 'failed' in target ? t('conn.failed', { why: target.failed }) : null;

  const active = (accounts ?? []).filter((a) => a.status === 'ACTIVE');
  const calendars = active.map((a) => a.toolkit).filter((slug) => CALENDARS.includes(slug)).join(',');

  // The next meetings, by title, so one can be prepared for. No contents.
  useEffect(() => {
    if (!calendars || into) return;
    let live = true;
    api
      .previewConnections(calendars.split(',') as ToolkitSlug[])
      .then((found) => live && setMeetings(found.items.filter((i) => i.kind === 'calendar_event').slice(0, MAX_MEETINGS)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [calendars, into]);

  const cap = into ? Math.max(0, MAX_HELD - (project?.held ?? 0)) : MAX_HELD;
  const busy = phase === 'searching' || phase === 'suggesting' || phase === 'starting';
  const why = (e: unknown) => t('conn.failed', { why: e instanceof Error ? e.message : '' });

  async function search(forMeeting: PreviewItem | null) {
    setPhase('searching');
    setError(null);
    setResult(null);
    setChosen([]);
    setShown(null);
    setSearched(false);
    setMeeting(forMeeting);
    try {
      const back = await api.searchConnections(
        forMeeting
          ? { meeting: toPicked(forMeeting), people: [forMeeting.who, ...forMeeting.people].filter(Boolean).slice(0, MAX_PEOPLE) }
          : { words: words.trim() }
      );
      const fromFiles = await Promise.all(back.files.map((f) => fileToText(f, t('conn.fileUnread'))));
      // The meeting's own read doesn't say when it is; the list it was pressed in does.
      const texts = [...back.items, ...fromFiles.filter(isText)]
        .map((x) => (forMeeting && itemKey(x) === itemKey(forMeeting) ? { ...x, when: forMeeting.when } : x))
        .slice(0, cap);
      setChosen(texts);
      setSkipped([...back.skipped, ...fromFiles.filter((x): x is Skipped => !isText(x))]);
      setProblems(back.problems.map((p) => `${toolkitLabel(p.toolkit)}: ${p.message}`));
      setSearched(true);
      if (!texts.length) setPhase('idle');
      else if (forMeeting) await startBriefing(forMeeting, texts);
      else if (into) setPhase('found');
      else await suggest(texts);
    } catch (e) {
      setError(why(e));
      setPhase('idle');
    }
  }

  async function suggest(items: ConnectedText[]) {
    setPhase('suggesting');
    setError(null);
    setRequestLanguage(startLanguage(getLocale()));
    try {
      const back = await api.suggestWorkflows({
        items: toSharedItems(items),
        catalog: EXAMPLE_CARDS.map((c) => ({
          key: c.key,
          title: t(`ex.${c.key}.title` as MessageKey),
          description: t(`ex.${c.key}.blurb` as MessageKey).slice(0, 400),
        })),
      });
      setSent(items);
      setResult(back);
      setPhase('suggestions');
    } catch (e) {
      setError(why(e));
      setPhase('found');
    } finally {
      setRequestLanguage('en');
    }
  }

  async function startBriefing(forMeeting: PreviewItem, items: ConnectedText[]) {
    const example = EXAMPLES.find((e) => e.key === 'meeting_briefing');
    if (!example || !user) return;
    setPhase('starting');
    setError(null);
    try {
      const title = forMeeting.title.length <= 60 ? forMeeting.title : `${forMeeting.title.slice(0, 57).trimEnd()}…`;
      const id = await startExample(example, user.id, {
        language: startLanguage(getLocale()),
        own: {
          title,
          objective: t('conn.briefingObjective', { title: forMeeting.title, when: shortWhen(forMeeting.when, locale) }),
          context: '',
          files: [],
          images: [],
          third_party: toThirdParty(items),
        },
      });
      goSignedIn(`/projects/${id}`);
    } catch (e) {
      setError(why(e));
      setPhase('found');
    }
  }

  /** "Start this" keeps what the suggestion came from and is still listed: everything listed if it names none. */
  function startFrom(s: Suggestion) {
    const listed = new Set(chosen.map(itemKey));
    const from = s.based_on.map((n) => sent[n - 1]).filter((x): x is ConnectedText => !!x && listed.has(itemKey(x)));
    rememberStartGoal(s.objective);
    rememberStartItems(toThirdParty(from.length ? from : chosen));
    goSignedIn('/projects/new');
  }

  /** Into the project it was opened from: merged with what it holds, re-read once if it moved on. */
  async function addToProject() {
    if (!into) return;
    setPhase('starting');
    setError(null);
    try {
      const added = toThirdParty(chosen);
      for (let attempt = 0; ; attempt++) {
        const current = await getProject(into);
        if (!current) throw new Error(t('conn.intoGone'));
        const { items: merged } = mergeThirdParty(current.third_party ?? [], added);
        try {
          await updateProject(into, { third_party: merged }, current.revision);
          break;
        } catch (e) {
          if (e instanceof ProjectConflictError && e.reason === 'stale' && attempt === 0) continue;
          throw e;
        }
      }
      goSignedIn(`/projects/${into}`);
    } catch (e) {
      setError(why(e));
      setPhase('found');
    }
  }

  const returnTo = into
    ? `/projects/from-accounts?into=${encodeURIComponent(into)}`
    : briefing
    ? '/projects/from-accounts?for=briefing'
    : '/projects/from-accounts';

  const running = phase === 'searching' ? t('conn.searching') : phase === 'suggesting' ? t('conn.suggesting') : phase === 'starting' ? t('conn.starting') : '';
  const showRead = chosen.length > 0 && phase !== 'searching';

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-display text-[var(--on-surface)]">
        {into ? t('conn.intoTitle') : briefing ? t('conn.entryBriefing') : t('conn.flowTitle')}
      </h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">
        {into ? (project ? (cap ? t('conn.intoLead', { title: project.title, count: cap }) : t('conn.intoFull', { max: MAX_HELD })) : '') : t('conn.flowLead')}
      </p>
      {into && (
        <Link href={`/projects/${into}`} className="mt-2 inline-block text-label font-medium text-[var(--pm-primary)] hover:underline">
          {t('conn.intoBack')}
        </Link>
      )}

      {(accounts === null || active.length === 0) && (
        <section className="mt-6">
          {accounts !== null && <p className="mb-3 text-title text-[var(--on-surface)]">{t('conn.noneConnected')}</p>}
          <p className="mb-3 text-label text-[var(--on-surface-variant)]">{t('conn.composioNote')}</p>
          <ConnectedAccounts returnTo={returnTo} onLoaded={setAccounts} />
        </section>
      )}

      {active.length > 0 && (
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void search(null);
          }}
        >
          <label htmlFor="account-search" className="text-title text-[var(--on-surface)]">{t('conn.searchLabel')}</label>
          <input
            id="account-search"
            dir="auto"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-xl bg-[var(--surface-container-low)] px-4 py-3 text-body text-[var(--on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]"
          />
          <p className="mt-1.5 text-label text-[var(--on-surface-variant)]">{t('conn.searchHint')}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy || (!!into && (!project || cap === 0))} className={primary}>
              {running || t('conn.search')}
            </button>
            <Link href="/projects/settings" className="text-label font-medium text-[var(--pm-primary)] hover:underline">{t('conn.manage')}</Link>
          </div>
        </form>
      )}

      {problems.map((p) => (
        <p key={p} role="status" className="mt-3 text-label text-[var(--on-surface-variant)]">{p}</p>
      ))}
      {searched && !chosen.length && !busy && !error && (
        <p role="status" className="mt-4 text-body text-[var(--on-surface)]">{t('conn.noneFound')}</p>
      )}

      {phase === 'suggestions' && result && (
        <>
          <h2 className="mt-8 text-headline text-[var(--on-surface)]">{t('conn.suggestTitle')}</h2>
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
                      {t('conn.basedOn', { titles: s.based_on.map((n) => sent[n - 1]?.title).filter(Boolean).join(', ') })}
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
        </>
      )}

      {showRead && (
        <section aria-label={t('conn.readTitle')}>
          <h2 className="mt-8 text-headline text-[var(--on-surface)]">{t('conn.readTitle')}</h2>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('conn.readLead')}</p>
          <ol className="mt-5 space-y-3">
            {chosen.map((item) => {
              const key = itemKey(item);
              return (
                <li key={key} className="rounded-xl bg-[var(--surface-container-low)] p-4">
                  <div className="flex items-start gap-2">
                    <ToolkitLogo slug={item.toolkit} size={20} className="mt-0.5 text-[var(--on-surface-variant)]" />
                    <p dir="auto" className="min-w-0 flex-1 text-title text-[var(--on-surface)]">{item.title}</p>
                    <button
                      type="button"
                      onClick={() => setChosen((held) => held.filter((c) => itemKey(c) !== key))}
                      className="shrink-0 text-label font-medium text-[var(--pm-primary)] hover:underline"
                    >
                      {t('conn.remove')}
                    </button>
                  </div>
                  <p dir="auto" className="text-label text-[var(--on-surface-variant)]">{item.source}</p>
                  <button
                    type="button"
                    aria-expanded={shown === key}
                    onClick={() => setShown(shown === key ? null : key)}
                    className="mt-1 text-label font-medium text-[var(--pm-primary)] hover:underline"
                  >
                    {shown === key ? t('conn.heldHide') : t('conn.heldShow')}
                  </button>
                  {shown === key && (
                    <pre dir="auto" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 font-sans text-label text-[var(--on-surface)]">
                      {item.text}
                    </pre>
                  )}
                </li>
              );
            })}
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
          {(meeting || into) && <p className="mt-5 text-label text-[var(--on-surface-variant)]">{t('conn.webOff')}</p>}
          {(phase === 'found' || (phase === 'starting' && !!into)) && (
            <div className="mt-5 flex flex-wrap gap-3">
              {into ? (
                <button type="button" onClick={() => void addToProject()} disabled={busy} className={primary}>
                  {phase === 'starting' ? t('conn.adding') : t('conn.addN', { count: chosen.length })}
                </button>
              ) : meeting ? (
                <button type="button" onClick={() => void startBriefing(meeting, chosen)} className={primary}>{t('conn.startBriefing')}</button>
              ) : (
                <button type="button" onClick={() => void suggest(chosen)} className={primary}>{t('conn.suggest')}</button>
              )}
            </div>
          )}
        </section>
      )}

      {!into && meetings.length > 0 && !showRead && (
        <section className="mt-8">
          <h2 className="text-title text-[var(--on-surface)]">{t('conn.nextMeetings')}</h2>
          <ul className="mt-2 space-y-1.5">
            {meetings.map((item) => (
              <li key={itemKey(item)} className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
                <ToolkitLogo slug={item.toolkit} size={18} className="mt-0.5 text-[var(--on-surface-variant)]" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-body text-[var(--on-surface)]">{item.title}</span>
                  <span dir="auto" className="block truncate text-label text-[var(--on-surface-variant)]">
                    {[item.who, shortWhen(item.when, locale), toolkitLabel(item.toolkit)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void search(item)}
                  className="shrink-0 rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
                >
                  {t('conn.brief')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(error || targetProblem) && (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--pm-error)]">{error || targetProblem}</p>
      )}
    </main>
  );
}
