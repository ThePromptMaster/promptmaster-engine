'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { useDismiss } from '@/components/projects/use-dismiss';
import { listProjects } from '@/lib/supabase/projects';
import type { ProjectFolder, ProjectSummary } from '@/types/project';

/** How many recent projects the picker offers before a search narrows them. */
const OFFERED = 200;

interface Props {
  folder: ProjectFolder;
  /** File one project here; the picker stays open so several can be moved. */
  onMove: (project: ProjectSummary) => Promise<void> | void;
}

/**
 * "Move projects here" on an empty folder (26 Nov, Sean: "It says you're allowed to drag
 * the projects into the folders, but I don't think it's working"). The empty folder said
 * "Drag a project here", but with the folder open there were no cards on screen to drag.
 * This works with a mouse, a keyboard and a finger alike.
 */
export function MoveHereMenu({ folder, onMove }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (!open || rows) return;
    let live = true;
    listProjects(OFFERED)
      .then((list) => live && setRows(list))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, rows]);

  const q = query.trim().toLowerCase();
  const offered = (rows ?? [])
    .filter((p) => p.folder_id !== folder.id || moved.has(p.id))
    .filter((p) => !q || `${p.title} ${p.objective ?? ''}`.toLowerCase().includes(q));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-move-here
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">drive_file_move</span>
        {t('list.moveHere')}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('list.moveHereTitle', { name: folder.name })}
          className="absolute start-1/2 top-full z-30 mt-2 w-[min(380px,86vw)] -translate-x-1/2 rounded-xl bg-[var(--surface-container-lowest)] p-2 text-start shadow-[0_1px_2px_rgba(25,28,30,0.06),0_12px_28px_-12px_rgba(25,28,30,0.3)] rtl:translate-x-1/2"
        >
          <p className="px-2 pb-1.5 pt-0.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('list.moveHereTitle', { name: folder.name })}</p>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('list.moveHereFilter')}
            placeholder={t('list.moveHereFilter')}
            className="mb-1.5 w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
          />
          {rows === null && !failed && <p className="px-2 py-2 text-label text-[var(--on-surface-variant)]">{t('list.moveHereLoading')}</p>}
          {failed && <p role="alert" className="px-2 py-2 text-label text-[var(--pm-error)]">{t('list.loadError')}</p>}
          {rows !== null && offered.length === 0 && <p className="px-2 py-2 text-label text-[var(--on-surface-variant)]">{t('list.moveHereNone')}</p>}
          <ul className="max-h-[300px] overflow-y-auto">
            {offered.map((p) => {
              const done = moved.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={done}
                    onClick={() => {
                      setMoved((m) => new Set(m).add(p.id));
                      void Promise.resolve(onMove(p)).catch(() =>
                        setMoved((m) => {
                          const next = new Set(m);
                          next.delete(p.id);
                          return next;
                        })
                      );
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] disabled:text-[var(--on-surface-variant)]"
                  >
                    <span aria-hidden className={`material-symbols-outlined text-[18px] ${done ? 'text-[var(--pm-primary)]' : 'text-[var(--on-surface-variant)]'}`}>
                      {done ? 'check' : 'description'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.title || t('list.untitled')}</span>
                    {done && <span className="shrink-0 text-label">{t('list.moveHereMoved')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-2 pt-1.5 text-label leading-snug text-[var(--on-surface-variant)]">{t('frules.moveNote')}</p>
        </div>
      )}
    </div>
  );
}
