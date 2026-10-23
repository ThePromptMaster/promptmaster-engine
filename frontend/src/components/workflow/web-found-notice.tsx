'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useProjectStore } from '@/stores/project-store';

/**
 * The latest web search a writer made on this stage (22 Oct): every draft,
 * revision, tool and Go step may search while Web access is on, and the user
 * is told when one did, and what it saved, rather than finding [S7] unexplained.
 */
export function WebFoundNotice({ projectId, stageId }: { projectId: string; stageId: string }) {
  const t = useT();
  const found = useProjectStore((s) => s.lastWeb);
  const addSources = useProjectStore((s) => s.addSources);
  if (!found || found.projectId !== projectId || (found.stageId && found.stageId !== stageId)) return null;
  return (
    <p role="status" className="mb-3 flex items-start gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-label text-[var(--on-surface-variant)]">
      <span aria-hidden className="material-symbols-outlined text-[16px]">{found.note ? 'public_off' : 'travel_explore'}</span>
      <span className="flex-1">
        {found.note || t('door.searched', { query: found.query, found: found.saved ? t('web.newSaved', { count: found.saved }) : t('door.noSources') })}
        {!found.note && found.saved > 0 ? t('wfn.listed') : ''}
      </span>
      <button
        type="button"
        aria-label={t('wfn.dismiss')}
        onClick={() => addSources([], null)}
        className="rounded p-0.5 hover:bg-[var(--surface-container-high)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </p>
  );
}
