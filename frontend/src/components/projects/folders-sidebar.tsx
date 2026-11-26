'use client';

import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { FOLDER_NAME_MAX, MAX_FOLDER_DEPTH, flattenTree, folderTree, kindUnder, type FolderNode } from '@/lib/supabase/folders';
import type { MessageKey } from '@/lib/i18n/messages/en';
import type { FolderKind, ProjectFolder, WorkspaceLayout } from '@/types/project';

/** What the list shows: everything, the Unfiled projects, or one folder. */
export type FolderSelection = 'all' | 'unfiled' | string;

/** The drag type a project card sets, so a folder row accepts only projects. */
export const PROJECT_DRAG_TYPE = 'application/x-pm-project';

const MAX_DEPTH = MAX_FOLDER_DEPTH;

/** A folder's icon says what it stands for (Sean, 23 Nov: workspace › client › search). */
const KIND_ICON: Record<FolderKind, string> = { workspace: 'domain', client: 'work', search: 'person_search', folder: 'folder' };

/** What a name field asks for, and what "new inside" makes, by the kind it will be (24 Nov, Sean: "how do I make the workspace folders?"). */
const NAME_KEY: Record<FolderKind, MessageKey> = { workspace: 'folders.nameWorkspace', client: 'folders.nameClient', search: 'folders.nameSearch', folder: 'folders.name' };
const NEW_IN_KEY: Partial<Record<FolderKind, [MessageKey, MessageKey]>> = {
  client: ['folders.newClientIn', 'folders.newClientInside'],
  search: ['folders.newSearchIn', 'folders.newSearchInside'],
};

interface Props {
  folders: readonly ProjectFolder[];
  /** Live projects per folder id; '' is Unfiled. */
  counts: Record<string, number>;
  selected: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  /**
   * `kind` is what the new folder stands for: a workspace at the top, and under one a
   * client, then a search, or plain folders in a blank workspace; `layout` is a new
   * workspace's template (26 Nov).
   */
  onCreate: (name: string, parentId: string | null, kind: FolderKind | null, layout?: WorkspaceLayout | null) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** A project dropped on a folder row (desktop), or on Unfiled (null). */
  onDropProject: (projectId: string, folderId: string | null) => void;
  /** Make the sample search-firm workspace (24 Nov). */
  onSample?: () => Promise<void>;
}

/**
 * The folder tree beside the projects list (client, 21 Oct, email 5: "a
 * sidebar somewhere that can arrow out and display all of the folders and
 * projects"). A project can be dragged onto a folder on a computer; the card's
 * folder button does the same everywhere, keyboard and touch included.
 */
export function FoldersSidebar({ folders, counts, selected, onSelect, onCreate, onRename, onDelete, onDropProject, onSample }: Props) {
  const t = useT();
  const tree = flattenTree(folderTree(folders));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // Which row is being named: a new folder (under a parent, or at the top), or a rename.
  const [naming, setNaming] = useState<
    { kind: 'new'; parentId: string | null; folderKind: FolderKind | null; layout?: WorkspaceLayout } | { kind: 'rename'; id: string } | null
  >(null);
  // "New workspace" asks which kind first (26 Nov, Sean: Executive Search as a template "alongside a blank workspace").
  const [choosingLayout, setChoosingLayout] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [makingSample, setMakingSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startNaming = (next: typeof naming, initial = '') => {
    setNaming(next);
    setName(initial);
    setError(null);
  };

  // Enter saves, and the field losing focus as it is disabled saved again: two folders of one
  // name (24 Nov pass). One save at a time.
  const saving = useRef(false);
  const submit = async () => {
    if (saving.current) return;
    if (!naming || !name.trim()) {
      setNaming(null);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (naming.kind === 'new') await onCreate(name, naming.parentId, naming.folderKind, naming.layout ?? null);
      else await onRename(naming.id, name);
      setNaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? t('folders.saveError')));
    } finally {
      setBusy(false);
      saving.current = false;
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(id);
      setConfirmDelete(null);
      if (selected === id) onSelect('all');
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? t('folders.deleteError')));
    } finally {
      setBusy(false);
    }
  };

  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(PROJECT_DRAG_TYPE);
      setDropTarget(null);
      if (!id) return;
      e.preventDefault();
      onDropProject(id, folderId);
    },
  });

  const nameInput = (indent: number, kind: FolderKind | null | undefined) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="py-1"
      style={{ paddingLeft: `${indent * 14 + 8}px` }}
    >
      <input
        autoFocus
        value={name}
        maxLength={FOLDER_NAME_MAX}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setNaming(null);
        }}
        aria-label={t(NAME_KEY[kind ?? 'folder'])}
        placeholder={t(NAME_KEY[kind ?? 'folder'])}
        className="w-full rounded-lg bg-[var(--surface-container-lowest)] px-2.5 py-1.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
      />
    </form>
  );

  const row = (key: FolderSelection, label: string, icon: string, count: number | undefined, folderId: string | null, indent = 0) => {
    const active = selected === key;
    return (
      <button
        type="button"
        onClick={() => onSelect(key)}
        aria-current={active ? 'true' : undefined}
        {...(key === 'all' ? {} : dropProps(String(key), folderId))}
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pe-2 text-start text-body transition-colors ${
          dropTarget === key
            ? 'bg-[color-mix(in_srgb,var(--pm-primary)_16%,transparent)] text-[var(--on-surface)]'
            : active
            ? 'bg-[var(--surface-container-high)] font-medium text-[var(--on-surface)]'
            : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]'
        }`}
        style={{ paddingLeft: `${indent * 14 + 8}px` }}
      >
        <span aria-hidden className="material-symbols-outlined shrink-0 text-[18px]">{icon}</span>
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        {count !== undefined && <span className="shrink-0 text-label tabular-nums text-[var(--on-surface-variant)]">{count}</span>}
      </button>
    );
  };

  const folderRow = (f: FolderNode) => (
    <li key={f.id}>
      {naming?.kind === 'rename' && naming.id === f.id ? (
        nameInput(f.depth, f.kind)
      ) : (
        // The actions sit over the row's end while it is hovered or focused, so
        // at rest the name has the whole width (23 Oct pass: "Prod ..." for a
        // short name). On a touch screen, with no hover, they stay in the row.
        <div className="group relative flex items-center">
          <div className="min-w-0 flex-1">{row(f.id, f.name, f.kind && f.kind !== 'folder' ? KIND_ICON[f.kind] : selected === f.id ? 'folder_open' : 'folder', counts[f.id] ?? 0, f.id, f.depth)}</div>
          <div className="absolute end-0 top-1/2 hidden -translate-y-1/2 rounded-md bg-[var(--surface-container-high)] group-focus-within:flex group-hover:flex [@media(hover:none)]:static [@media(hover:none)]:flex [@media(hover:none)]:shrink-0 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:bg-transparent">
            {f.depth + 1 < MAX_DEPTH && (
              <button type="button" onClick={() => startNaming({ kind: 'new', parentId: f.id, folderKind: kindUnder(f, folders) })} aria-label={t(NEW_IN_KEY[kindUnder(f, folders) ?? 'folder']?.[0] ?? 'folders.newIn', { name: f.name })} title={t(NEW_IN_KEY[kindUnder(f, folders) ?? 'folder']?.[1] ?? 'folders.newInside')} className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
                <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
              </button>
            )}
            <button type="button" onClick={() => startNaming({ kind: 'rename', id: f.id }, f.name)} aria-label={t('folders.renameNamed', { name: f.name })} title={t('folders.rename')} className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </button>
            <button type="button" onClick={() => setConfirmDelete(f.id)} aria-label={t('folders.deleteNamed', { name: f.name })} title={t('folders.delete')} className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        </div>
      )}
      {confirmDelete === f.id && (
        <div role="alert" className="my-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label text-[var(--on-surface)]" style={{ marginLeft: `${f.depth * 14}px` }}>
          <p>{t('folders.confirmDelete', { name: f.name })}</p>
          <p className="mt-1 text-[var(--on-surface-variant)]">{t('frules.deleteToo')}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void remove(f.id)} className="rounded-lg bg-[var(--pm-error)] px-3 py-1 text-[var(--on-error)] disabled:opacity-60">{t('folders.deleteFolder')}</button>
            <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg px-2 py-1 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]">{t('folders.keep')}</button>
          </div>
        </div>
      )}
      {naming?.kind === 'new' && naming.parentId === f.id && nameInput(f.depth + 1, naming.folderKind)}
    </li>
  );

  return (
    <nav aria-label={t('folders.label')} className="space-y-1">
      {row('all', t('folders.all'), 'workspaces', total, null)}
      {row('unfiled', t('folders.unfiled'), 'inbox', counts[''] ?? 0, null)}
      <div className="flex items-center justify-between pt-4 pb-1 ps-2">
        <h2 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('folders.heading')}</h2>
        <button
          type="button"
          onClick={() => startNaming({ kind: 'new', parentId: null, folderKind: null })}
          aria-label={t('folders.new')}
          title={t('folders.new')}
          className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
        </button>
      </div>
      <ul className="space-y-0.5">
        {tree.map(folderRow)}
        {naming?.kind === 'new' && naming.parentId === null && <li>{nameInput(0, naming.folderKind)}</li>}
      </ul>
      {/* A workspace is made here, not only by the sample: under it "new inside" makes a
          client, and under a client a search, each with its own rules (24 Nov, Sean). */}
      <button
        type="button"
        data-new-workspace
        aria-expanded={choosingLayout}
        onClick={() => {
          setNaming(null);
          setChoosingLayout((open) => !open);
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)] hover:text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">add</span>
        {t('folders.newWorkspace')}
      </button>
      {choosingLayout && (
        <div role="group" aria-label={t('folders.layoutTitle')} data-workspace-layouts className="space-y-1 rounded-lg bg-[var(--surface-container)] p-2">
          <p className="px-1 text-label text-[var(--on-surface-variant)]">{t('folders.layoutTitle')}</p>
          {(['blank', 'executive_search'] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              data-layout={layout}
              onClick={() => {
                setChoosingLayout(false);
                startNaming({ kind: 'new', parentId: null, folderKind: 'workspace', layout });
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-[var(--surface-container-high)]"
            >
              <span aria-hidden className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--on-surface-variant)]">{layout === 'blank' ? 'folder' : 'person_search'}</span>
              <span className="min-w-0">
                <span className="block text-label font-semibold text-[var(--on-surface)]">{t(layout === 'blank' ? 'folders.layoutBlank' : 'folders.layoutSearch')}</span>
                <span className="block text-label leading-snug text-[var(--on-surface-variant)]">{t(layout === 'blank' ? 'folders.layoutBlankHint' : 'folders.layoutSearchHint')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {tree.length === 0 && naming === null && (
        <p className="px-2 text-label leading-snug text-[var(--on-surface-variant)]">
          {t('folders.emptyHint')}
        </p>
      )}
      {onSample && (
        <button
          type="button"
          disabled={makingSample}
          onClick={() => void (async () => {
            setMakingSample(true);
            setError(null);
            try {
              await onSample();
            } catch (e) {
              setError(e instanceof Error && e.message ? e.message : t('frules.sampleError'));
            } finally {
              setMakingSample(false);
            }
          })()}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-label text-[var(--pm-primary)] hover:bg-[var(--surface-container)] disabled:opacity-50"
        >
          <span aria-hidden className="material-symbols-outlined text-[16px]">domain</span>
          {makingSample ? t('frules.sampleMaking') : t('frules.sample')}
        </button>
      )}
      {error && <p role="alert" className="px-2 text-label text-[var(--pm-error)]">{error}</p>}
    </nav>
  );
}
