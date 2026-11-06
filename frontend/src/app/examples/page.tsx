'use client';

import Link from 'next/link';

import { ExampleCards } from '@/components/examples/example-cards';
import { ExampleQuestionnaire } from '@/components/examples/example-questionnaire';
import { useT } from '@/lib/i18n/i18n-provider';

export default function ExamplesPage() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('ex.kicker')}</p>
      <h1 className="mt-2 text-display text-[var(--on-surface)]">{t('ex.title')}</h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">{t('ex.lead')}</p>
      <div className="mt-6">
        <ExampleCards />
      </div>
      <div className="mt-6">
        <ExampleQuestionnaire />
      </div>
      <Link href="/projects/new" className="mt-6 inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline">
        {t('ex.startOwn')}
        <span aria-hidden className="material-symbols-outlined text-[18px] rtl:-scale-x-100">arrow_forward</span>
      </Link>
    </main>
  );
}
