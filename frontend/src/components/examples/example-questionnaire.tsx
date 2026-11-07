'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { StartAttachments } from '@/components/projects/start-attachments';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api/client';
import { guestErrorMessage } from '@/lib/auth/guest';
import { goSignedIn } from '@/lib/auth/sign-in';
import { documentsOf, type PreparedFile } from '@/lib/data/attachments';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';
import { NEED_ANSWERS, WORK_ANSWERS, rankExamples } from '@/lib/projects/examples/rank';
import { rememberStartGoal } from '@/lib/projects/example-goals';
import { loadAnswers, saveAnswers } from '@/lib/supabase/preferences';

/**
 * Three quick questions, for someone not sure which example is theirs (the client's
 * call, 4 Nov). Never in the way: folded until asked for, every answer optional. The two
 * taps rank the examples with no model; they are remembered for a signed-in user.
 *
 * What they type or attach goes nowhere until they press something. "Start from this"
 * takes it to the start box. "Suggest work for me" sends it for one model call and shows
 * up to three pieces of work; nothing is saved, and no account is read.
 */
/** The most of one document a suggestion reads (`personalization.MAX_ITEM_CHARS`). */
const SUGGEST_ITEM_CHARS = 12_000;
/** And of everything together (`personalization.MAX_ITEMS_CHARS`), leaving room for the note. */
const SUGGEST_FILE_CHARS = 28_000;

type Suggested = Awaited<ReturnType<typeof api.suggestWorkflows>>;

export function ExampleQuestionnaire() {
  const t = useT();
  const router = useRouter();
  const { user, continueAsGuest } = useAuth();
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState<string | undefined>();
  const [need, setNeed] = useState<string | undefined>();
  const [plate, setPlate] = useState('');
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [cut, setCut] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  // Their earlier taps, if any. A failure just means asking again.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadAnswers(userId)
      .then((saved) => {
        if (!live || !saved) return;
        setWork(saved.work);
        setNeed(saved.need);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId]);

  function answer(next: { work?: string; need?: string }) {
    setWork(next.work);
    setNeed(next.need);
    if (userId) {
      void saveAnswers(userId, next).catch(() => undefined);
    }
  }

  const documents = documentsOf(files);
  const hasSomething = Boolean(plate.trim() || documents.length);

  async function suggest() {
    if (suggesting || !hasSomething) return;
    setSuggesting(true);
    setFailed(null);
    setSuggested(null);
    try {
      if (!user) {
        try {
          await continueAsGuest();
        } catch (e) {
          throw new Error(guestErrorMessage(e instanceof Error ? e.message : ''));
        }
      }
      // Files share what a note leaves, in the order they were attached.
      let room = SUGGEST_FILE_CHARS;
      const shortened: string[] = [];
      const items: { kind: 'note' | 'file'; title: string; text: string }[] = plate.trim()
        ? [{ kind: 'note', title: 'What they said', text: plate.trim().slice(0, SUGGEST_ITEM_CHARS) }]
        : [];
      for (const doc of documents) {
        const take = Math.min(room, SUGGEST_ITEM_CHARS);
        if (take <= 0 || items.length >= 8) {
          shortened.push(doc.name);
          continue;
        }
        if (doc.text.length > take) shortened.push(doc.name);
        const text = doc.text.slice(0, take);
        room -= text.length;
        items.push({ kind: 'file', title: doc.name.slice(0, 300), text });
      }
      const answers: Record<string, string> = { ...(work ? { work } : {}), ...(need ? { need } : {}) };
      const result = await api.suggestWorkflows({
        items,
        catalog: EXAMPLE_CARDS.map((c) => ({
          key: c.key,
          title: t(`ex.${c.key}.title` as MessageKey),
          description: t(`ex.${c.key}.blurb` as MessageKey).slice(0, 400),
        })),
        profile: answers,
      });
      setCut(shortened);
      setSuggested(result);
    } catch (e) {
      setFailed(t('ex.suggestFailed', { why: e instanceof Error && e.message ? e.message : t('ex.failedUnknown') }));
    } finally {
      setSuggesting(false);
    }
  }

  function startSuggestion(objective: string) {
    rememberStartGoal(objective);
    // A full page load, so the proxy sees a session that may have just started.
    goSignedIn('/projects/new');
  }

  const top = rankExamples(work, need)[0];
  const card = EXAMPLE_CARDS.find((c) => c.key === top)!;
  const chip = (selected: boolean) =>
    `rounded-full px-3 py-1.5 text-label transition-colors ${
      selected
        ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
        : 'bg-[var(--surface-container-high)] text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]'
    }`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">quiz</span>
        {t('ex.askOpen')}
      </button>
    );
  }

  return (
    <section aria-label={t('ex.askTitle')} className="rounded-2xl bg-[var(--surface-container-low)] p-5 text-start">
      <h3 className="text-title text-[var(--on-surface)]">{t('ex.askTitle')}</h3>

      <p className="mt-4 text-label font-semibold text-[var(--on-surface)]">{t('ex.askWork')}</p>
      <div role="group" aria-label={t('ex.askWork')} className="mt-2 flex flex-wrap gap-2">
        {WORK_ANSWERS.map((a) => (
          <button key={a} type="button" aria-pressed={work === a} onClick={() => answer({ work: work === a ? undefined : a, need })} className={chip(work === a)}>
            {t(`ex.work.${a}` as MessageKey)}
          </button>
        ))}
      </div>

      <p className="mt-4 text-label font-semibold text-[var(--on-surface)]">{t('ex.askNeed')}</p>
      <div role="group" aria-label={t('ex.askNeed')} className="mt-2 flex flex-wrap gap-2">
        {NEED_ANSWERS.map((a) => (
          <button key={a} type="button" aria-pressed={need === a} onClick={() => answer({ work, need: need === a ? undefined : a })} className={chip(need === a)}>
            {t(`ex.need.${a}` as MessageKey)}
          </button>
        ))}
      </div>

      {(work || need) && (
        <Link
          href={exampleHref(card.slug)}
          className="mt-4 flex gap-3 rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 transition-colors hover:bg-[var(--surface-container-high)]"
        >
          <span aria-hidden className="material-symbols-outlined text-[22px] text-[var(--pm-primary)]">{card.icon}</span>
          <span className="min-w-0">
            <span className="block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('ex.startHere')}</span>
            <span className="mt-0.5 block text-title text-[var(--on-surface)]">{t(`ex.${card.key}.title` as MessageKey)}</span>
          </span>
        </Link>
      )}

      <label htmlFor="example-plate" className="mt-4 block text-label font-semibold text-[var(--on-surface)]">{t('ex.askPlate')}</label>
      <textarea
        id="example-plate"
        value={plate}
        onChange={(e) => setPlate(e.target.value)}
        rows={2}
        className="mt-2 w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]"
      />
      <StartAttachments
        files={files}
        images={[]}
        onFiles={setFiles}
        onImages={() => undefined}
        disabled={suggesting}
        documentsOnly
        hint={t('ex.suggestAttach')}
        buttonLabel={t('ex.suggestAttachButton')}
      />
      {hasSomething && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void suggest()}
              disabled={suggesting}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--pm-primary)] px-3 py-2 text-label font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">auto_awesome</span>
              {suggesting ? t('ex.suggesting') : t('ex.suggest')}
            </button>
            {plate.trim() && (
              <button
                type="button"
                onClick={() => {
                  rememberStartGoal(plate);
                  router.push('/projects/new');
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
              >
                {t('ex.startFromPlate')}
                <span aria-hidden className="material-symbols-outlined text-[16px] rtl:-scale-x-100">arrow_forward</span>
              </button>
            )}
          </div>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('ex.suggestNote')}</p>
        </>
      )}
      {failed && <p role="alert" className="mt-3 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--on-surface)]">{failed}</p>}
      {suggested && (
        <div aria-label={t('ex.suggestTitle')} role="region" className="mt-5">
          {suggested.suggestions.length === 0 ? (
            <p className="text-body text-[var(--on-surface-variant)]">{t('ex.suggestNone')}</p>
          ) : (
            <>
              <h4 className="text-title text-[var(--on-surface)]">{t('ex.suggestTitle')}</h4>
              {suggested.work_summary && (
                <p className="mt-1 text-body text-[var(--on-surface-variant)]">{t('ex.suggestSummary', { summary: suggested.work_summary })}</p>
              )}
              <ul className="mt-3 space-y-3">
                {suggested.suggestions.map((s) => {
                  const example = EXAMPLE_CARDS.find((c) => c.key === s.example_key);
                  return (
                    <li key={s.title} className="rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3">
                      <p className="text-title text-[var(--on-surface)]">{s.title}</p>
                      {s.why && <p className="mt-1 text-body text-[var(--on-surface-variant)]">{s.why}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => startSuggestion(s.objective)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
                        >
                          {t('ex.suggestStart')}
                          <span aria-hidden className="material-symbols-outlined text-[16px] rtl:-scale-x-100">arrow_forward</span>
                        </button>
                        {example && (
                          <Link href={exampleHref(example.slug)} className="text-label font-medium text-[var(--pm-primary)] hover:underline">
                            {t('ex.suggestExample')}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {cut.length > 0 && (
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('ex.suggestCut', { names: cut.join(', ') })}</p>
          )}
        </div>
      )}
    </section>
  );
}
