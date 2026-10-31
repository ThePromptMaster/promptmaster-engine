'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n/i18n-provider';

import { FolderChoices } from '@/components/projects/move-to-menu';
import { UseInProjectPanel } from '@/components/projects/use-in-project-menu';
import type { ProjectFolder, ProjectSummary } from '@/types/project';

type View = 'menu' | 'use' | 'move';

/**
 * A project card's actions on a phone, behind one button (Sean, 24 Oct: "I'm
 * having trouble getting this to do anything"). Three icons on every card left
 * the title a few letters wide, and a tap meant for the project opened "Use in
 * another project" over the list instead. Here the card is the tap target and
 * the actions open in a sheet from the bottom of the screen.
 */
export function ProjectCardMenu({
  project,
  userId,
  projects,
  folders,
  onMove,
  onDelete,
  onCopy,
}: {
  project: ProjectSummary;
  userId: string | undefined;
  projects: readonly ProjectSummary[];
  folders: readonly ProjectFolder[];
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
  /** Make a copy and keep the original (31 Oct). */
  onCopy?: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<View | null>(null);
  const close = () => setView(null);
  const name = project.title || t('list.aProject');

  useEffect(() => {
    if (!view) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [view]);

  const row = 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]';

  return (
    <>
      <button
        type="button"
        onClick={() => setView('menu')}
        aria-haspopup="dialog"
        aria-expanded={view !== null}
        aria-label={t('card.more', { name })}
        className="rounded-lg p-2 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[22px]">more_vert</span>
      </button>
      {view &&
        createPortal(
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={name}>
            <button type="button" aria-label={t('card.close')} onClick={close} className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-[var(--surface-container-lowest)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_28px_-12px_rgba(25,28,30,0.3)]">
              <div className="mb-2 flex items-center gap-2">
                {view !== 'menu' && (
                  <button type="button" onClick={() => setView('menu')} aria-label={t('card.back')} className="rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
                    <span aria-hidden className="material-symbols-outlined rtl:-scale-x-100 text-[20px]">arrow_back</span>
                  </button>
                )}
                <p className="min-w-0 flex-1 truncate text-title text-[var(--on-surface)]">
                  {view === 'use' ? t('useIn.dialog') : view === 'move' ? t('move.menu') : name}
                </p>
                <button type="button" onClick={close} aria-label={t('card.close')} className="rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
                  <span aria-hidden className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {view === 'menu' && (
                <ul>
                  {userId && (
                    <li>
                      <button type="button" className={row} onClick={() => setView('use')}>
                        <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]">link</span>
                        {t('card.useIn')}
                      </button>
                    </li>
                  )}
                  {onCopy && (
                    <li>
                      <button
                        type="button"
                        className={row}
                        onClick={() => {
                          close();
                          onCopy();
                        }}
                      >
                        <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]">content_copy</span>
                        {t('card.copy')}
                      </button>
                    </li>
                  )}
                  <li>
                    <button type="button" className={row} onClick={() => setView('move')}>
                      <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]">drive_file_move</span>
                      {t('card.move')}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`${row} text-[var(--pm-error)]`}
                      onClick={() => {
                        close();
                        onDelete();
                      }}
                    >
                      <span aria-hidden className="material-symbols-outlined text-[20px]">delete</span>
                      {t('card.delete')}
                    </button>
                  </li>
                </ul>
              )}

              {view === 'use' && userId && <UseInProjectPanel source={project} userId={userId} projects={projects} folders={folders} />}

              {view === 'move' && (
                <div role="menu" aria-label={t('move.menu')}>
                  <FolderChoices
                    folderId={project.folder_id}
                    folders={folders}
                    onChoose={(id) => {
                      close();
                      if (id !== (project.folder_id ?? null)) onMove(id);
                    }}
                  />
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
