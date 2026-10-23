'use client';

import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { submitFeedback } from '@/lib/supabase/feedback';
import { useT } from '@/lib/i18n/i18n-provider';

const REUSE_SCALE = [1, 2, 3, 4, 5] as const;

interface FeedbackFormProps {
  /** Attach the feedback to whatever the user was working on, if anything. */
  projectId?: string | null;
  onClose?: () => void;
}

/**
 * FR-22: the beta feedback questionnaire.
 *
 * Four questions, and only four — task/use case, what was valuable, where the
 * user got confused or blocked, and how likely they are to come back. They are
 * the section-10 validation framework questions, so they are asked in that
 * order and stored in named columns rather than a blob.
 */
export function FeedbackForm({ projectId = null, onClose }: FeedbackFormProps) {
  const { user, loading } = useAuth();
  const t = useT();

  const [useCase, setUseCase] = useState('');
  const [value, setValue] = useState('');
  const [blockage, setBlockage] = useState('');
  const [reuse, setReuse] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedback(
        {
          use_case: useCase,
          value,
          blockage,
          reuse_likelihood: reuse,
          project_id: projectId,
        },
        user.id
      );
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('feedback.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-5">
        <p className="text-title text-[var(--on-surface)]">{t('feedback.thanks')}</p>
        <p className="mt-1 text-body text-[var(--on-surface-variant)]">
          {t('feedback.thanksBody')}
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
          >
            {t('feedback.close')}
          </button>
        )}
      </div>
    );
  }

  if (!loading && !user) {
    return (
      <div className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-5">
        <p className="text-body text-[var(--on-surface-variant)]">
          {t('feedback.signIn')}
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-1 py-1 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            {t('feedback.close')}
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-5"
    >
      <p className="text-title text-[var(--on-surface)]">{t('feedback.title')}</p>
      <p className="mt-1 max-w-[62ch] text-body text-[var(--on-surface-variant)]">
        {t('feedback.intro')}
      </p>

      <label className="mt-5 block">
        <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {t('feedback.useCase')}
        </span>
        <textarea
          required
          rows={2}
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          className="w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none"
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {t('feedback.value')}
        </span>
        <textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none"
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {t('feedback.blockage')}
        </span>
        <textarea
          rows={2}
          value={blockage}
          onChange={(e) => setBlockage(e.target.value)}
          className="w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none"
        />
      </label>

      <fieldset className="mt-5">
        <legend className="mb-2 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {t('feedback.reuse')}
        </legend>
        <div className="flex items-center gap-3">
          <span className="text-body text-[var(--on-surface-variant)]">{t('feedback.notLikely')}</span>
          <div className="flex gap-2">
            {REUSE_SCALE.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={reuse === n}
                onClick={() => setReuse(n)}
                className={`h-10 w-10 rounded-xl text-title transition-opacity hover:opacity-90 ${
                  reuse === n
                    ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                    : 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-body text-[var(--on-surface-variant)]">{t('feedback.veryLikely')}</span>
        </div>
      </fieldset>

      {error && (
        <div className="mt-4 rounded-xl bg-[var(--error-container)] px-4 py-3">
          <p className="text-body text-[var(--on-error-container)]">{error}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t('feedback.sending') : t('feedback.send')}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2.5 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            {t('feedback.notNow')}
          </button>
        )}
      </div>
    </form>
  );
}
