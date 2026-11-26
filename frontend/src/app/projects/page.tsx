'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { listProjects, moveProject, softDeleteProject } from '@/lib/supabase/projects';
import { FOLDER_NAME_MAX, MAX_FOLDER_DEPTH, createFolder, deleteFolder, folderCounts, kindUnder, layoutOf, listFolders, renameFolder, workspaceOf } from '@/lib/supabase/folders';
import { FolderRulesPanel } from '@/components/projects/folder-rules-panel';
import { FoldersSidebar, type FolderSelection } from '@/components/projects/folders-sidebar';
import { MoveToMenu } from '@/components/projects/move-to-menu';
import { MoveHereMenu } from '@/components/projects/move-here-menu';
import { beginProjectDrag, endProjectDrag } from '@/lib/projects/project-drag';
import { foldersHolding } from '@/lib/projects/folder-totals';
import { UseInProjectMenu } from '@/components/projects/use-in-project-menu';
import { ProjectCardMenu } from '@/components/projects/project-card-menu';
import { pausedProjectIds, templateNamesById } from '@/lib/supabase/workflow';
import { useProjectStore } from '@/stores/project-store';
import type { FolderKind, ProjectFolder, ProjectSummary, WorkspaceLayout } from '@/types/project';
import { accentVariables } from '@/lib/appearance/colours';
import { GuestBanner } from '@/components/projects/guest-banner';
import { DeletedProjects } from '@/components/projects/deleted-projects';
import { ExampleCards } from '@/components/examples/example-cards';
import { ExampleQuestionnaire } from '@/components/examples/example-questionnaire';
import { PromptyHelp } from '@/components/examples/prompty-help';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { shownStageId } from '@/lib/i18n/stage';
import { workflowName } from '@/lib/i18n/templates';
import { relativeTime } from '@/lib/i18n/format';
import { copyProject, copyTitle } from '@/lib/supabase/copy-project';

const WORKFLOW_ICON: Record<string, string> = {
  book: 'menu_book',
  research: 'science',
  single_output: 'bolt',
};


/** The folder last chosen on this browser; a convenience, not project data. */
const FOLDER_KEY = 'pm.projectsFolder';

function storedSelection(): FolderSelection {
  try {
    return window.localStorage.getItem(FOLDER_KEY) || 'all';
  } catch {
    return 'all';
  }
}

/**
 * Whether the pointer is a mouse and the folders are beside the list. Only then is a
 * card draggable onto a folder: on a phone a tap is for opening the project, and
 * filing goes through the card's menu (Sean, 24 Oct); in a narrow window the folders
 * are in a sheet that covers the list, so there is nowhere to drop (26 Nov).
 */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(pointer: fine) and (min-width: 768px)');
    const update = () => setFine(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return fine;
}

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const finePointer = useFinePointer();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  // Each pinned template's name and stage labels: a designed workflow showed
  // its `custom_` key on the list (28 Oct).
  const [templateNames, setTemplateNames] = useState<
    Map<string, { name: string; stages: Record<string, string> }>
  >(new Map());
  const pinned = (p: ProjectSummary) =>
    p.workflow_template_id ? templateNames.get(p.workflow_template_id) : undefined;
  const workflowLabel = (p: ProjectSummary) => workflowName(locale, p.workflow, pinned(p)?.name ?? p.workflow);
  const stageLabel = (p: ProjectSummary) => {
    const shown = shownStageId(p.workflow, p.stage);
    // A system stage translated into the interface's language wins; otherwise
    // the template's own short label, then the id.
    return shown !== p.stage.replace(/_/g, ' ') ? shown : pinned(p)?.stages[p.stage] ?? shown;
  };
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const [listFailed, setListFailed] = useState(false);
  const [paused, setPaused] = useState<Set<string>>(new Set());

  // Folders (client, 21 Oct, email 5): the tree beside the list, and which one is shown.
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<FolderSelection>(() => (typeof window === 'undefined' ? 'all' : storedSelection()));
  const [foldersOpen, setFoldersOpen] = useState(false);
  // The card being dragged, and what the last move did (26 Nov, Sean: a drop looked like
  // nothing happened, so it read as not working).
  const [dragging, setDragging] = useState<{ id: string; title: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!notice) return;
    // Long enough to read and press Undo: at 9 s it had gone before the press (26 Nov pass).
    const timer = setTimeout(() => setNotice(null), 15_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadFolders = useCallback(() => {
    Promise.all([listFolders(), folderCounts()])
      .then(([rows, byFolder]) => {
        setFolders(rows);
        setCounts(byFolder);
        // A remembered folder that is gone (deleted elsewhere) shows everything.
        setSelection((s) => (s !== 'all' && s !== 'unfiled' && !rows.some((f) => f.id === s) ? 'all' : s));
      })
      // Before the migration, or offline: the list still works without folders.
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    // A project just left may still have a debounced edit on its way — the
    // status Finish set, the stage it moved to. Leaving by a link does not wait
    // for it, and the list read the old row (7 Oct): "Finished" showed under
    // In progress. Send it first, then read.
    useProjectStore
      .getState()
      .flush()
      .catch(() => undefined)
      .then(() => listProjects(50, selection === 'all' ? undefined : selection))
      .then((rows) => {
        setProjects(rows);
        // Paused on an unmet objective: said on the list, not only on the project.
        pausedProjectIds(rows.filter((p) => p.status !== 'finalized').map((p) => p.id))
          .then(setPaused)
          .catch(() => undefined);
        templateNamesById(rows.flatMap((p) => (p.workflow_template_id ? [p.workflow_template_id] : [])))
          .then(setTemplateNames)
          .catch(() => undefined);
      })
      .catch((e) => {
        setListFailed(true);
        setError(e instanceof Error ? e.message : t('list.loadError'));
      });
  }, [selection, t]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    loadFolders();
  }, [user, loadFolders]);

  function select(next: FolderSelection) {
    setSelection(next);
    setFoldersOpen(false);
    setProjects(null);
    try {
      window.localStorage.setItem(FOLDER_KEY, next);
    } catch {
      // Private windows: the choice lasts for this page only.
    }
  }

  /**
   * Make a copy and open it; the original stays as it is (31 Oct: "more like a
   * copy thing … so you have the original project too as well").
   */
  const [copying, setCopying] = useState<string | null>(null);
  async function handleCopy(id: string) {
    if (copying) return;
    setCopying(id);
    setError(null);
    try {
      const made = await copyProject(id);
      // A stored file that would not copy is said here, beside the new copy,
      // rather than discovered later in it.
      if (made.missing.length) {
        setError(t('list.copyMissing', { files: made.missing.join(', ') }));
        setCopying(null);
        void load();
        return;
      }
      router.push(`/projects/${made.projectId}`);
    } catch (e) {
      setError(e instanceof Error && e.message ? t('list.copyFailedWhy', { message: e.message }) : t('list.copyFailed'));
      setCopying(null);
    }
  }

  /**
   * File a project, and say so: where it went, with Undo (26 Nov). `known` is the card when
   * it is not in the list on screen (moved in from "Move projects here").
   */
  async function handleMove(id: string, folderId: string | null, known?: ProjectSummary, quiet = false) {
    const previous = projects;
    const card = known ?? projects?.find((p) => p.id === id);
    const from = card ? card.folder_id ?? null : undefined;
    if (card && (card.folder_id ?? null) === folderId) return;
    const shown = (fid: string | null) => selection === 'all' || (selection === 'unfiled' ? fid === null : fid === selection);
    setProjects((rows) => {
      const list = rows ?? [];
      const moved = list.some((p) => p.id === id)
        ? list.map((p) => (p.id === id ? { ...p, folder_id: folderId } : p))
        : card && shown(folderId)
        ? [{ ...card, folder_id: folderId }, ...list]
        : list;
      return moved.filter((p) => p.id !== id || shown(folderId));
    });
    try {
      await moveProject(id, folderId);
      loadFolders();
      // A card brought in from another folder is read again with its workflow's name
      // (26 Nov pass: it showed its template key).
      if (known && !projects?.some((p) => p.id === id)) load();
      if (quiet) return;
      const title = card?.title || t('list.aProject');
      const folderName = folderId ? folders.find((f) => f.id === folderId)?.name ?? t('list.thisFolder') : null;
      setNotice({
        text: folderName ? t('list.movedTo', { title, folder: folderName }) : t('list.movedOut', { title }),
        undo: from === undefined ? undefined : () => {
          setNotice(null);
          void handleMove(id, from, card ? { ...card, folder_id: folderId } : undefined, true);
        },
      });
    } catch (e) {
      setProjects(previous);
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? t('list.moveError')));
    }
  }

  const createAndShow = async (name: string, parentId: string | null, kind: FolderKind | null, layout: WorkspaceLayout | null = null) => {
    if (!user) return;
    // A workspace from "New workspace", blank or executive search; then under it folders, or a
    // client and a search under a client (Sean, 23–26 Nov: `kindUnder`); the folder's panel changes it.
    const made = await createFolder(user.id, name, parentId, kind, layout);
    loadFolders();
    // A new workspace opens at once, ready for a project or a folder (26 Nov: "start a project right away").
    if (kind === 'workspace') select(made.id);
  };
  // Adding a folder from an empty folder's own card (26 Nov).
  const [addingInside, setAddingInside] = useState<string | null>(null);
  const [insideName, setInsideName] = useState('');
  const rename = async (id: string, name: string) => {
    await renameFolder(id, name);
    loadFolders();
  };
  const remove = async (id: string) => {
    await deleteFolder(id);
    loadFolders();
    load();
  };

  const selectedFolder = selection === 'all' || selection === 'unfiled' ? null : folders.find((f) => f.id === selection) ?? null;
  const depthOf = (folder: ProjectFolder) => {
    let depth = 0;
    for (let at = folder; at.parent_id && depth < MAX_FOLDER_DEPTH; depth += 1) {
      const up = folders.find((f) => f.id === at.parent_id);
      if (!up) break;
      at = up;
    }
    return depth;
  };
  const selectedLabel =
    selection === 'all' ? null : selection === 'unfiled' ? t('folders.unfiled') : selectedFolder?.name ?? null;

  const sidebar = (
    <FoldersSidebar
      folders={folders}
      counts={counts}
      selected={selection}
      onSelect={select}
      onCreate={createAndShow}
      onRename={rename}
      onDelete={remove}
      onDropProject={(id, folderId) => void handleMove(id, folderId)}
      dragging={dragging?.title ?? null}
      onSample={async () => {
        if (!user) return;
        // The sample search-firm workspace (24 Nov): made in the user's own account, then shown.
        const { startSearchFirmSample } = await import('@/lib/projects/demo/start-search-firm');
        const made = await startSearchFirmSample(user.id, locale);
        loadFolders();
        select(made.workspaceId);
      }}
    />
  );

  // Signed out by the time the page ran (an expired session the server had
  // not yet noticed): the list would otherwise be a skeleton forever.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/login?next=/projects');
  }, [authLoading, user, router]);

  async function handleDelete(id: string) {
    const previous = projects;
    setProjects((p) => (p ?? []).filter((x) => x.id !== id));
    setPendingDelete(null);
    try {
      await softDeleteProject(id);
    } catch (e) {
      // Put it back rather than leaving the list lying about what exists.
      setProjects(previous);
      setError(e instanceof Error ? e.message : t('list.deleteError'));
    }
  }

  // While the session is checked the list shows its skeleton, not a blank page.

  const active = projects?.filter((p) => p.status !== 'finalized') ?? [];
  const finalized = projects?.filter((p) => p.status === 'finalized') ?? [];

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-14 md:grid md:grid-cols-[232px_minmax(0,1fr)] md:gap-10">
      {/* The folder tree: a column on a computer or tablet, a sheet on a phone. */}
      <aside className="hidden md:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl bg-[var(--surface-container-low)] p-3">{sidebar}</div>
      </aside>
      {foldersOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('list.folders')}>
          <button type="button" aria-label={t('list.closeFolders')} onClick={() => setFoldersOpen(false)} className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-y-0 start-0 w-[86vw] max-w-[320px] overflow-y-auto bg-[var(--surface-container-low)] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-title text-[var(--on-surface)]">{t('list.folders')}</span>
              <button type="button" onClick={() => setFoldersOpen(false)} aria-label={t('list.closeFolders')} className="rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      )}
      <div className="min-w-0">
      <header className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <button
            type="button"
            onClick={() => setFoldersOpen(true)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] md:hidden"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">folder_open</span>
            {selectedLabel ? t('list.foldersWith', { name: selectedLabel }) : t('list.folders')}
          </button>
          <h1 className="text-display text-[var(--on-surface)]">{selectedLabel ?? t('list.title')}</h1>
          <p className="mt-3 text-body text-[var(--on-surface-variant)]">{t('list.subtitle')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
        {selectedFolder && (projects?.length ?? 0) > 0 && (
          <MoveHereMenu folder={selectedFolder} onMove={(p) => handleMove(p.id, selectedFolder.id, p)} />
        )}
        <Link
          // Started in a folder, a project is filed there and follows its rules from the start (Sean, 23 Nov).
          href={selectedFolder ? `/projects/new?folder=${selectedFolder.id}` : '/projects/new'}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          {t('list.newProject')}
        </Link>
        </div>
      </header>

      <GuestBanner />

      {selectedFolder && <FolderRulesPanel key={selectedFolder.id} folder={selectedFolder} layout={layoutOf(workspaceOf(selectedFolder, folders))} onKindChanged={loadFolders} projects={(projects ?? []).map((p) => ({ id: p.id, title: p.title }))} />}

      {error && (
        <div role="alert" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <span>{listFailed ? t('list.loadFailed', { error }) : error}</span>
          {listFailed && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setListFailed(false);
                load();
              }}
              className="rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label text-[var(--on-surface)]"
            >
              {t('list.retry')}
            </button>
          )}
        </div>
      )}

      {projects === null && !listFailed && (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[84px] animate-pulse rounded-2xl bg-[var(--surface-container-low)]"
            />
          ))}
        </div>
      )}

      {projects?.length === 0 && selection !== 'all' && (
        <div data-empty-folder className="rounded-2xl bg-[var(--surface-container-low)] px-8 py-12 text-center text-body text-[var(--on-surface-variant)]">
          <span aria-hidden className="material-symbols-outlined text-[32px] opacity-50">folder_open</span>
          {/* Said once: a folder whose projects sit in folders inside it is not "empty" (26 Nov pass). */}
          {!(selectedFolder && foldersHolding(selectedFolder.id, folders, counts).length > 0) && (
            <p className="mt-3">{t('list.emptyFolder', { name: selectedLabel ?? t('list.thisFolder') })}</p>
          )}
          {/* A folder whose projects are all in folders inside it is not empty (26 Nov: the
              sample workspace read "Nothing in … yet" over two levels of projects). */}
          {selectedFolder && foldersHolding(selectedFolder.id, folders, counts).length > 0 && (
            <div data-nested-projects className="mt-3">
              <p>{t('list.nested', { name: selectedFolder.name })}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {foldersHolding(selectedFolder.id, folders, counts).map(({ folder, total }) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => select(folder.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
                  >
                    <span aria-hidden className="material-symbols-outlined text-[16px]">{'folder'}</span>
                    {folder.name}
                    <span className="tabular-nums text-[var(--on-surface-variant)]">{total}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* An empty folder says what to do in it (26 Nov, Sean: "someone should be able to
              start a project right away or organize projects by whatever makes sense"). */}
          {selectedFolder && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {/* Filing from here: an empty folder has no cards on screen to drag (26 Nov). */}
              <MoveHereMenu
                folder={selectedFolder}
                onMove={(p) => handleMove(p.id, selectedFolder.id, p)}
              />
              <Link
                href={`/projects/new?folder=${selectedFolder.id}`}
                data-start-here
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90"
              >
                <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
                {t('list.startHere')}
              </Link>
              {depthOf(selectedFolder) + 1 < MAX_FOLDER_DEPTH && addingInside !== selectedFolder.id && (
                <button
                  type="button"
                  data-add-inside
                  onClick={() => {
                    setAddingInside(selectedFolder.id);
                    setInsideName('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
                >
                  <span aria-hidden className="material-symbols-outlined text-[18px]">create_new_folder</span>
                  {t('list.addInside')}
                </button>
              )}
            </div>
          )}
          {selectedFolder && addingInside === selectedFolder.id && (
            <form
              className="mx-auto mt-3 flex max-w-[420px] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = insideName.trim();
                if (!name) return;
                setAddingInside(null);
                void createAndShow(name, selectedFolder.id, kindUnder(selectedFolder, folders)).catch((err) =>
                  setError(err instanceof Error ? err.message : t('folders.saveError'))
                );
              }}
            >
              <input
                autoFocus
                value={insideName}
                maxLength={FOLDER_NAME_MAX}
                onChange={(e) => setInsideName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAddingInside(null);
                }}
                aria-label={t('folders.name')}
                placeholder={t('folders.name')}
                className="min-w-0 flex-1 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
              />
              <button type="submit" className="rounded-lg bg-[var(--pm-primary)] px-3 py-2 text-label font-semibold text-[var(--on-primary)]">
                {t('list.addInsideSave')}
              </button>
            </form>
          )}
          <button type="button" onClick={() => select('all')} className="mt-4 block w-full text-label text-[var(--pm-primary)] hover:underline">
            {t('list.showAll')}
          </button>
        </div>
      )}

      <PromptyHelp place="list" autoOpen={projects?.length === 0 && selection === 'all'} />
      {projects?.length === 0 && selection === 'all' && (
        <div className="rounded-2xl bg-[var(--surface-container-low)] px-8 py-16 text-center">
          <span
            aria-hidden
            className="material-symbols-outlined text-[32px] text-[var(--on-surface-variant)] opacity-50"
          >
            workspaces
          </span>
          <p className="mt-3 text-headline text-[var(--on-surface)]">{t('list.emptyTitle')}</p>
          <p className="mx-auto mt-2 max-w-[460px] text-body text-[var(--on-surface-variant)]">{t('list.emptyBody')}</p>
          <section aria-label={t('ex.startFrom')} className="mx-auto mt-5 max-w-[640px] text-start">
            <h3 className="mb-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('ex.startFrom')}</h3>
            <ExampleCards />
            <div className="mt-4">
              <ExampleQuestionnaire />
            </div>
          </section>
          <Link
            href="/projects/new"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)]"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t('list.newProject')}
          </Link>
        </div>
      )}

      {[
        { key: 'active', label: t('list.inProgress'), rows: active },
        { key: 'finalized', label: t('list.finished'), rows: finalized },
      ].map(({ key, label, rows }) =>
        rows.length === 0 ? null : (
          <section key={key} className="mb-10">
            <h2 className="mb-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
              {label} · {rows.length}
            </h2>

            <ul className="space-y-2">
              {rows.map((p) => (
                <li
                  key={p.id}
                  draggable={finePointer}
                  onDragStart={(e) => {
                    if (!finePointer) return;
                    beginProjectDrag(e.dataTransfer, p.id);
                    setDragging({ id: p.id, title: p.title || t('list.aProject') });
                  }}
                  onDragEnd={() => {
                    endProjectDrag();
                    setDragging(null);
                  }}
                  className={dragging?.id === p.id ? 'opacity-60' : undefined}
                >
                  <div style={accentVariables(p.accent) as React.CSSProperties} className="group relative flex items-center gap-1 rounded-2xl bg-[var(--surface-container-low)] sm:gap-4 transition-all duration-200 hover:bg-[var(--surface-container-lowest)] hover:shadow-[0_1px_2px_rgba(25,28,30,0.04),0_8px_20px_-10px_rgba(25,28,30,0.2)]">
                    {/* The project's own colour, as a bar and a tinted icon: the icon alone was easy to miss (21 Oct). */}
                    {p.accent && <span aria-hidden className="absolute inset-y-3 start-0 w-1 rounded-e-full bg-[var(--pm-primary)]" />}
                    <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-4 ps-5 pe-1 sm:gap-4 sm:px-6 sm:py-5">
                      <span
                        aria-hidden
                        className={`material-symbols-outlined shrink-0 text-[22px] ${p.accent ? 'rounded-lg bg-[color-mix(in_srgb,var(--pm-primary)_14%,transparent)] p-1.5 text-[var(--pm-primary)]' : 'text-[var(--on-surface-variant)]'}`}
                      >
                        {WORKFLOW_ICON[p.workflow] ?? 'workspaces'}
                      </span>

                      <span className="min-w-0 flex-1">
                        {/* A copy's title ends " (copy)"; kept outside the truncation so a long copy is not identical to its original (31 Oct). */}
                        {copyTitle(p.title).suffix ? (
                          <span className="flex min-w-0 items-baseline gap-1 text-title text-[var(--on-surface)]">
                            <span className="min-w-0 truncate">{copyTitle(p.title).base || t('list.untitled')}</span>
                            <span className="shrink-0">{copyTitle(p.title).suffix}</span>
                          </span>
                        ) : (
                          <span className="block truncate text-title text-[var(--on-surface)]">
                            {p.title || t('list.untitled')}
                          </span>
                        )}
                        <span className="mt-1 block truncate text-body text-[var(--on-surface-variant)]">
                          {p.objective || t('list.noObjective')}
                        </span>
                      </span>

                      <span className="hidden shrink-0 items-center gap-2 text-label text-[var(--on-surface-variant)] sm:flex">
                        {p.example_key && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 font-semibold text-[var(--pm-primary)]">
                            {t('ex.chip')}
                          </span>
                        )}
                        {/* Where it is filed, in the list of everything (26 Nov): a drop there
                            changed nothing on the card, so it looked as if it had not worked. */}
                        {selection === 'all' && p.folder_id && folders.some((f) => f.id === p.folder_id) && (
                          <span data-card-folder className="inline-flex max-w-[160px] items-center gap-1 rounded-md bg-[var(--surface-container-high)] px-2 py-1" title={t('list.inFolder', { name: folders.find((f) => f.id === p.folder_id)!.name })}>
                            <span aria-hidden className="material-symbols-outlined text-[14px]">{'folder'}</span>
                            <span className="truncate">{folders.find((f) => f.id === p.folder_id)!.name}</span>
                          </span>
                        )}
                        <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                          {workflowLabel(p)}
                        </span>
                        {p.status !== 'finalized' && paused.has(p.id) && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 font-semibold text-[var(--pm-tertiary)]" title={t('list.pausedWhy')}>
                            {t('list.paused')}
                          </span>
                        )}
                        {p.status !== 'finalized' && p.stage && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                            {stageLabel(p)}
                          </span>
                        )}
                        <span className="w-[64px] text-end tabular-nums">
                          {relativeTime(p.updated_at, locale)}
                        </span>
                      </span>
                    </Link>

                    <div className="flex shrink-0 items-center pe-2 sm:pe-4">
                      {pendingDelete === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="rounded-lg bg-[var(--pm-error)] px-3 py-1.5 text-label text-[var(--on-error)]"
                          >
                            {t('list.delete')}
                          </button>
                          <button
                            onClick={() => setPendingDelete(null)}
                            className="rounded-lg px-2 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                          >
                            {t('list.keep')}
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* A computer with a mouse: the three icons, shown on hover. */}
                          <div className="hidden items-center [@media(hover:hover)_and_(min-width:640px)]:flex">
                            {user && <UseInProjectMenu source={p} userId={user.id} projects={projects ?? []} folders={folders} />}
                            <MoveToMenu projectTitle={p.title} folderId={p.folder_id} folders={folders} onMove={(folderId) => void handleMove(p.id, folderId)} />
                            <button
                              onClick={() => void handleCopy(p.id)}
                              disabled={copying !== null}
                              aria-label={t('list.copyNamed', { name: p.title || t('list.aProject') })}
                              title={t('card.copy')}
                              className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                            >
                              <span className={`material-symbols-outlined text-[20px] ${copying === p.id ? 'animate-spin' : ''}`}>{copying === p.id ? 'progress_activity' : 'content_copy'}</span>
                            </button>
                            <button
                              onClick={() => setPendingDelete(p.id)}
                              aria-label={t('list.deleteNamed', { name: p.title || t('list.aProject') })}
                              className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <span className="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                          </div>
                          {/* A phone or a tablet: one button, so the card itself is what a tap opens (Sean, 24 Oct). */}
                          <div className="[@media(hover:hover)_and_(min-width:640px)]:hidden">
                            <ProjectCardMenu
                              project={p}
                              userId={user?.id}
                              projects={projects ?? []}
                              folders={folders}
                              onMove={(folderId) => void handleMove(p.id, folderId)}
                              onDelete={() => setPendingDelete(p.id)}
                              onCopy={() => void handleCopy(p.id)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {/* FR-20. Last on the page and closed by default: trash is somewhere you
          go looking for, not something that competes with the work. */}
      {projects !== null && <DeletedProjects onRestored={load} />}
      </div>
      {/* Where to drop, while a card is dragged: over the page, so nothing moves under the pointer. */}
      {dragging && (
        <div role="status" data-drop-hint className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="max-w-[560px] rounded-xl bg-[var(--inverse-surface,#2e3133)] px-4 py-3 text-body text-[var(--inverse-on-surface,#eff1f3)] shadow-[0_8px_24px_-8px_rgba(25,28,30,0.45)]">
            {t('folders.dropHint', { name: dragging.title })}
          </div>
        </div>
      )}
      {notice && !dragging && (
        <div role="status" data-move-notice className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="flex max-w-[560px] items-center gap-3 rounded-xl bg-[var(--inverse-surface,#2e3133)] px-4 py-3 text-body text-[var(--inverse-on-surface,#eff1f3)] shadow-[0_8px_24px_-8px_rgba(25,28,30,0.45)]">
            <span aria-hidden className="material-symbols-outlined text-[18px]">drive_file_move</span>
            <span className="min-w-0">{notice.text}</span>
            {notice.undo && (
              <button type="button" onClick={notice.undo} className="shrink-0 rounded-lg px-2 py-1 font-semibold text-[var(--inverse-primary,#9ecfd0)] hover:underline">
                {t('list.undo')}
              </button>
            )}
            <button type="button" onClick={() => setNotice(null)} aria-label={t('list.closeNotice')} className="shrink-0 rounded-lg p-1 opacity-80 hover:opacity-100">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
