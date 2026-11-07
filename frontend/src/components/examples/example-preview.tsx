'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { StartAttachments, type StartImage } from '@/components/projects/start-attachments';
import { MarkdownOutput } from '@/components/shared/markdown-output';
import { useAuth } from '@/hooks/use-auth';
import { guestErrorMessage } from '@/lib/auth/guest';
import { goSignedIn } from '@/lib/auth/sign-in';
import { documentsOf, type PreparedFile } from '@/lib/data/attachments';
import { contextFromDocuments } from '@/lib/data/extract-text';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { getLocale } from '@/lib/i18n/store';
import { stageText } from '@/lib/i18n/templates';
import { csvPreview, exampleWorkflow, resultOf, type Example } from '@/lib/projects/examples';
import { startExample } from '@/lib/projects/examples/start-example';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { splitAsk } from '@/lib/projects/split-ask';
import { createClient } from '@/lib/supabase/client';
import { startLanguage } from '@/lib/workflow/languages';

/**
 * One example, before anything exists: what you get, how it runs, the sample,
 * and what uses credit. Public, because "what does this do?" should not need an
 * account (a tester, 4 Nov), and opening it creates nothing. Only a press below
 * makes a project.
 */
export function ExamplePreview({ example }: { example: Example }) {
  const t = useT();
  const locale = useLocale();
  const { user, loading, continueAsGuest } = useAuth();
  const [working, setWorking] = useState<null | 'sample' | 'own'>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [ask, setAsk] = useState('');
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [images, setImages] = useState<StartImage[]>([]);

  // The key's suffix only has to look like a real one: nothing here is saved.
  const template = useMemo(() => exampleWorkflow(example, '0000000000'), [example]);
  const word = (field: string) => t(`ex.${example.key}.${field}` as MessageKey);
  const result = resultOf(example);

  async function whoIsStarting(): Promise<string> {
    if (user) return user.id;
    try {
      await continueAsGuest();
    } catch (e) {
      throw new Error(guestErrorMessage(e instanceof Error ? e.message : ''));
    }
    const { data } = await createClient().auth.getUser();
    if (!data.user) throw new Error(t('ex.failedUnknown'));
    return data.user.id;
  }

  async function start(kind: 'sample' | 'own') {
    if (working) return;
    setWorking(kind);
    setError(null);
    try {
      const userId = await whoIsStarting();
      const asked = splitAsk(ask);
      const firstLine = asked.objective.split('\n')[0] ?? '';
      const id = await startExample(example, userId, {
        language: startLanguage(getLocale()),
        ...(kind === 'own'
          ? {
              own: {
                title: firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`,
                objective: asked.objective,
                context: contextFromDocuments(asked.context, documentsOf(files), INPUT_LIMITS.context).context,
                files,
                images,
              },
            }
          : {}),
      });
      // A full page load, so the proxy sees a session that may have just started.
      goSignedIn(`/projects/${id}`);
    } catch (e) {
      setError(t('ex.failed', { why: e instanceof Error && e.message ? e.message : t('ex.failedUnknown') }));
      setWorking(null);
    }
  }

  const signedOut = !loading && !user;
  const nextHere = `/auth/login?next=${encodeURIComponent(`/examples/${example.slug}`)}`;

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/examples" className="inline-flex items-center gap-1 text-label text-[var(--on-surface-variant)] hover:underline">
        <span aria-hidden className="material-symbols-outlined text-[16px] rtl:-scale-x-100">arrow_back</span>
        {t('ex.all')}
      </Link>

      <h1 className="mt-4 flex items-center gap-3 text-display text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[36px] text-[var(--pm-primary)]">{example.icon}</span>
        {word('title')}
      </h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">{word('blurb')}</p>

      <section aria-label={t('ex.try')} className="mt-6 rounded-2xl bg-[var(--surface-container-low)] p-5">
        <button
          type="button"
          onClick={() => void start('sample')}
          disabled={working !== null || loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <span aria-hidden className="material-symbols-outlined text-[20px]">play_arrow</span>
          {working === 'sample' ? t('ex.starting') : t('ex.try')}
        </button>
        <p className="mt-3 text-label text-[var(--on-surface-variant)]">
          {t('ex.tryNote')}
          {signedOut && (
            <>
              {' '}{t('ex.tryGuest')}{' '}
              <Link href={nextHere} className="font-medium text-[var(--pm-primary)] hover:underline">{t('ex.signInFirst')}</Link>
            </>
          )}
        </p>
      </section>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-[var(--surface-container-high)] px-4 py-3 text-body text-[var(--pm-error)]">
          {error}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('ex.getsTitle')}</h2>
        <p className="mt-2 text-body text-[var(--on-surface)]">{word('gets')}</p>
      </section>

      {result && (
        <section className="mt-8">
          <h2 className="text-headline text-[var(--on-surface)]">{t('ex.resultTitle')}</h2>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">
            {t('ex.resultNote', {
              date: new Date(result.date).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' }),
              minutes: result.minutes,
              cost: result.costUsd.toFixed(2),
            })}
          </p>
          <button
            type="button"
            onClick={() => setShowResult((v) => !v)}
            aria-expanded={showResult}
            className="mt-2 inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">{showResult ? 'expand_less' : 'expand_more'}</span>
            {showResult ? t('ex.resultHide') : t('ex.resultShow')}
          </button>
          {showResult && (
            <div dir="ltr" lang="en" data-finished-result className="mt-3 rounded-xl bg-[var(--surface-container-lowest)] p-4 text-start">
              <MarkdownOutput content={result.text} />
            </div>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('ex.stagesTitle')}</h2>
        <ol className="mt-3 space-y-2">
          {template.stages.map((stage, i) => (
            <li key={stage.id} className="flex gap-3 rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3">
              <span aria-hidden className="text-label font-semibold text-[var(--pm-primary)]">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-title text-[var(--on-surface)]">{stageText(locale, template.key, stage, 'label')}</span>
                <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">{stageText(locale, template.key, stage, 'guidance')}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('ex.sampleTitle')}</h2>
        <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('ex.sampleNote')}</p>
        <button
          type="button"
          onClick={() => setShowSample((v) => !v)}
          aria-expanded={showSample}
          className="mt-2 inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline"
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">{showSample ? 'expand_less' : 'expand_more'}</span>
          {showSample ? t('ex.sampleHide') : t('ex.sampleShow')}
        </button>
        {showSample && (
          <div dir="ltr" lang="en" className="mt-3 space-y-4 rounded-xl bg-[var(--surface-container-lowest)] p-4 text-start">
            <p className="whitespace-pre-wrap text-body text-[var(--on-surface)]">{example.project.context}</p>
            {(example.files ?? []).map((f) => {
              const preview = csvPreview(f.text);
              return (
                <div key={f.name}>
                  <p className="text-label font-semibold text-[var(--on-surface)]">{t('ex.dataFile', { name: f.name })}</p>
                  <div className="mt-1 overflow-x-auto">
                    <table className="w-full text-label text-[var(--on-surface-variant)]">
                      <thead>
                        <tr>{preview.header.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 text-start font-semibold">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r[0]}>{r.map((c, i) => <td key={i} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.more > 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('ex.moreRows', { count: preview.more })}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-headline text-[var(--on-surface)]">{t('ex.creditTitle')}</h2>
        <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('ex.creditBody')}</p>
      </section>

      <section className="mt-8 rounded-2xl bg-[var(--surface-container-low)] p-5">
        <h2 className="text-headline text-[var(--on-surface)]">{t('ex.ownTitle')}</h2>
        <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('ex.ownLead')}</p>
        <label htmlFor="example-own" className="mt-4 block text-label font-semibold text-[var(--on-surface)]">{t('ex.ownLabel')}</label>
        <textarea
          id="example-own"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          maxLength={INPUT_LIMITS.message}
          rows={4}
          placeholder={word('ownPlaceholder')}
          className="mt-1 w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-primary)]"
        />
        <div className="mt-2">
          <StartAttachments files={files} images={images} onFiles={setFiles} onImages={setImages} disabled={working !== null} />
        </div>
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('ex.ownNote')}</p>
        <button
          type="button"
          onClick={() => void start('own')}
          disabled={!ask.trim() || working !== null || loading}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-title text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
        >
          <span aria-hidden className="material-symbols-outlined text-[20px] rtl:-scale-x-100">arrow_forward</span>
          {working === 'own' ? t('ex.starting') : t('ex.ownStart')}
        </button>
      </section>
    </main>
  );
}
