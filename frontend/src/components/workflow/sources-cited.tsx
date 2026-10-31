'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { sourcesCitedIn } from '@/lib/workflow/sources';
import { useProjectStore } from '@/stores/project-store';

/**
 * The saved web sources a version cites, listed beneath it by PromptMaster
 * (31 Oct, Sean: the model wrote a 40-row sources table into the book, more
 * than once, and the length limit paid for it). The text cites [S n]; the list
 * is drawn from the project's sources, so it is never cut off or out of date.
 */
export function SourcesCited({ content }: { content: string }) {
  const t = useT();
  const sources = useProjectStore((s) => s.sources);
  const cited = sourcesCitedIn(content, sources);
  if (!cited.length) return null;
  return (
    <section aria-label={t('web.citedLabel')} className="mt-6 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
      <h4 className="flex items-center gap-2 text-label font-semibold text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">link</span>
        {t('web.cited')}
      </h4>
      <ol className="mt-2 space-y-1">
        {cited.map(({ n, source: s }) => (
          <li key={s.id} className="text-label text-[var(--on-surface)]">
            <span className="font-semibold">[S{n}] </span>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--pm-primary)] underline">
              {s.title || s.url}
            </a>
            <span className="ms-2 text-[var(--on-surface-variant)]">{t('web.retrieved', { date: s.retrieved_at.slice(0, 10) })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
