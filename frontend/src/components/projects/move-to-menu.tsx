'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { useDismiss } from '@/components/projects/use-dismiss';
import { flattenTree, folderTree } from '@/lib/supabase/folders';
import type { ProjectFolder } from '@/types/project';

interface Props {
  projectTitle: string;
  folderId: string | null | undefined;
  folders: readonly ProjectFolder[];
  onMove: (folderId: string | null) => void;
}

/**
 * File a project from its card (client, 21 Oct, email 5). The one way that
 * works everywhere — on a phone, and from the keyboard — where dragging the
 * card onto the sidebar is the shortcut on a computer.
 */
export function MoveToMenu({ projectTitle, folderId, folders, onMove }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('move.button', { name: projectTitle || t('list.aProject') })}
        title={t('move.title')}
        className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <span className="material-symbols-outlined text-[20px]">drive_file_move</span>
      </button>
      {open && (
        <div role="menu" aria-label={t('move.menu')} className="absolute right-0 top-full z-20 mt-1 w-[240px] rounded-xl bg-[var(--surface-container-lowest)] p-1.5 shadow-[0_1px_2px_rgba(25,28,30,0.06),0_12px_28px_-12px_rgba(25,28,30,0.3)]">
          <p className="px-2.5 pb-1 pt-0.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('move.menu')}</p>
          <FolderChoices
            folderId={folderId}
            folders={folders}
            onChoose={(id) => {
              setOpen(false);
              if (id !== (folderId ?? null)) onMove(id);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Unfiled and every folder, the current one ticked: in the popover on a computer and the sheet on a phone. */
export function FolderChoices({
  folderId,
  folders,
  onChoose,
}: {
  folderId: string | null | undefined;
  folders: readonly ProjectFolder[];
  onChoose: (folderId: string | null) => void;
}) {
  const t = useT();
  const options = flattenTree(folderTree(folders));
  const item = (id: string | null, label: string, depth: number) => {
    const current = (folderId ?? null) === id;
    return (
      <li key={id ?? 'unfiled'}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={current}
          onClick={() => onChoose(id)}
          className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-3 text-left text-body ${current ? 'font-medium text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'} hover:bg-[var(--surface-container-high)]`}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">{id ? 'folder' : 'inbox'}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {current && <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--pm-primary)]">check</span>}
        </button>
      </li>
    );
  };

  return (
    <>
      <ul className="max-h-[280px] overflow-y-auto">
        {item(null, t('folders.unfiled'), 0)}
        {options.map((f) => item(f.id, f.name, f.depth))}
      </ul>
      {options.length === 0 && <p className="px-2.5 py-1.5 text-label text-[var(--on-surface-variant)]">{t('move.none')}</p>}
    </>
  );
}
