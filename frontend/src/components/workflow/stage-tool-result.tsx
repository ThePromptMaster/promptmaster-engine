'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { MarkdownOutput } from '@/components/shared/markdown-output';
import type { Commentary, ToolKind } from './use-stage-tools';

interface Props {
  running: ToolKind | null;
  error: string | null;
  commentary: Commentary | null;
  onDismiss: () => void;
}

/**
 * What a stage tool is doing, or what it said (PM-10).
 *
 * Rewrites land as a new version in the version bar, so all this shows for
 * them is progress. Critiques are commentary about the draft and are shown
 * here in full, beside it — they never replace it.
 */
export function StageToolResult({ running, error, commentary, onDismiss }: Props) {
  const t = useT();
  if (running) {
    return (
      <div role="status" className="mb-6 flex items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--pm-primary)] border-t-transparent"
        />
        <span className="text-body text-[var(--on-surface-variant)]">{t(`str.${running}`)}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-[var(--error-container)] px-5 py-3">
        <p className="flex-1 text-body text-[var(--on-error-container)]">{error}</p>
        <button onClick={onDismiss} className="text-label text-[var(--on-error-container)] underline">
          {t('str.dismiss')}
        </button>
      </div>
    );
  }

  if (!commentary) return null;

  return (
    <section aria-label={t(`tool.title.${commentary.kind}`)} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-6 py-5">
      <header className="mb-3 flex items-center gap-2">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">
          forum
        </span>
        <h3 className="flex-1 text-title text-[var(--on-surface)]">{t(`tool.title.${commentary.kind}`)}</h3>
        <button
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          {t('str.close')}
        </button>
      </header>
      <p className="mb-3 text-label text-[var(--on-surface-variant)]">
        {t('str.note')}
      </p>
      <MarkdownOutput content={commentary.text} />
    </section>
  );
}
