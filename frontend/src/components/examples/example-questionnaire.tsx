'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';
import { NEED_ANSWERS, WORK_ANSWERS, rankExamples } from '@/lib/projects/examples/rank';
import { rememberStartGoal } from '@/lib/projects/example-goals';
import { loadAnswers, saveAnswers } from '@/lib/supabase/preferences';

/**
 * Three quick questions, for someone not sure which example is theirs (the client's
 * call, 4 Nov). Never in the way: folded until asked for, every answer optional, and no
 * model is asked. The two taps are remembered for a signed-in user; what they type goes
 * to the start box and nowhere else.
 */
export function ExampleQuestionnaire() {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState<string | undefined>();
  const [need, setNeed] = useState<string | undefined>();
  const [plate, setPlate] = useState('');

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
      {plate.trim() && (
        <button
          type="button"
          onClick={() => {
            rememberStartGoal(plate);
            router.push('/projects/new');
          }}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
        >
          {t('ex.startFromPlate')}
          <span aria-hidden className="material-symbols-outlined text-[16px] rtl:-scale-x-100">arrow_forward</span>
        </button>
      )}
    </section>
  );
}
