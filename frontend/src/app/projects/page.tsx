'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { listProjects, moveProject, softDeleteProject } from '@/lib/supabase/projects';
import { createFolder, deleteFolder, folderCounts, listFolders, renameFolder } from '@/lib/supabase/folders';
import { FoldersSidebar, PROJECT_DRAG_TYPE, type FolderSelection } from '@/components/projects/folders-sidebar';
import { MoveToMenu } from '@/components/projects/move-to-menu';
import { UseInProjectMenu } from '@/components/projects/use-in-project-menu';
import { pausedProjectIds } from '@/lib/supabase/workflow';
import { useProjectStore } from '@/stores/project-store';
import type { ProjectFolder, ProjectSummary } from '@/types/project';
import { accentVariables } from '@/lib/appearance/colours';
import { GuestBanner } from '@/components/projects/guest-banner';
import { DeletedProjects } from '@/components/projects/deleted-projects';
import { newProjectHref } from '@/lib/projects/example-goals';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { relativeTime } from '@/lib/i18n/format';

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

/** The example goals on the empty list, in the interface's language (`lib/projects/example-goals.ts` holds the English). */
const EXAMPLES = ['memo', 'briefing', 'plan'] as const;

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const workflowLabel = (key: string) =>
    key === 'book' || key === 'research' || key === 'single_output' ? t(`workflow.name.${key}`) : key;

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const [listFailed, setListFailed] = useState(false);
  const [paused, setPaused] = useState<Set<string>>(new Set());

  // Folders (client, 21 Oct, email 5): the tree beside the list, and which one is shown.
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<FolderSelection>(() => (typeof window === 'undefined' ? 'all' : storedSelection()));
  const [foldersOpen, setFoldersOpen] = useState(false);

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

  async function handleMove(id: string, folderId: string | null) {
    const previous = projects;
    const shown = (fid: string | null) => selection === 'all' || (selection === 'unfiled' ? fid === null : fid === selection);
    setProjects((rows) => (rows ?? []).map((p) => (p.id === id ? { ...p, folder_id: folderId } : p)).filter((p) => p.id !== id || shown(folderId)));
    try {
      await moveProject(id, folderId);
      loadFolders();
    } catch (e) {
      setProjects(previous);
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? t('list.moveError')));
    }
  }

  const createAndShow = async (name: string, parentId: string | null) => {
    if (!user) return;
    await createFolder(user.id, name, parentId);
    loadFolders();
  };
  const rename = async (id: string, name: string) => {
    await renameFolder(id, name);
    loadFolders();
  };
  const remove = async (id: string) => {
    await deleteFolder(id);
    loadFolders();
    load();
  };

  const selectedLabel =
    selection === 'all' ? null : selection === 'unfiled' ? t('folders.unfiled') : folders.find((f) => f.id === selection)?.name ?? null;

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
          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[320px] overflow-y-auto bg-[var(--surface-container-low)] p-4 shadow-xl">
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
        <Link
          href="/projects/new"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          {t('list.newProject')}
        </Link>
      </header>

      <GuestBanner />

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
        <div className="rounded-2xl bg-[var(--surface-container-low)] px-8 py-12 text-center text-body text-[var(--on-surface-variant)]">
          <span aria-hidden className="material-symbols-outlined text-[32px] opacity-50">folder_open</span>
          <p className="mt-3">{t('list.emptyFolder', { name: selectedLabel ?? t('list.thisFolder') })}</p>
          <button type="button" onClick={() => select('all')} className="mt-4 text-label text-[var(--pm-primary)] hover:underline">
            {t('list.showAll')}
          </button>
        </div>
      )}

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
          <ul className="mx-auto mt-5 flex max-w-[560px] flex-col gap-2 text-left">
            {EXAMPLES.map((key) => ({ label: t(`examples.${key}.label`), goal: t(`examples.${key}.goal`) })).map((example) => (
              <li key={example.label}>
                <Link
                  href={newProjectHref(example.goal)}
                  className="block rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 transition-colors hover:bg-[var(--surface-container-high)]"
                >
                  <span className="block text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                    {example.label}
                  </span>
                  <span className="mt-1 block text-body text-[var(--on-surface)]">{example.goal}</span>
                </Link>
              </li>
            ))}
          </ul>
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PROJECT_DRAG_TYPE, p.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <div style={accentVariables(p.accent) as React.CSSProperties} className="group relative flex items-center gap-4 rounded-2xl bg-[var(--surface-container-low)] transition-all duration-200 hover:bg-[var(--surface-container-lowest)] hover:shadow-[0_1px_2px_rgba(25,28,30,0.04),0_8px_20px_-10px_rgba(25,28,30,0.2)]">
                    {/* The project's own colour, as a bar and a tinted icon: the icon alone was easy to miss (21 Oct). */}
                    {p.accent && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--pm-primary)]" />}
                    <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-4 px-6 py-5">
                      <span
                        aria-hidden
                        className={`material-symbols-outlined shrink-0 text-[22px] ${p.accent ? 'rounded-lg bg-[color-mix(in_srgb,var(--pm-primary)_14%,transparent)] p-1.5 text-[var(--pm-primary)]' : 'text-[var(--on-surface-variant)]'}`}
                      >
                        {WORKFLOW_ICON[p.workflow] ?? 'workspaces'}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-title text-[var(--on-surface)]">
                          {p.title || t('list.untitled')}
                        </span>
                        <span className="mt-1 block truncate text-body text-[var(--on-surface-variant)]">
                          {p.objective || t('list.noObjective')}
                        </span>
                      </span>

                      <span className="hidden shrink-0 items-center gap-2 text-label text-[var(--on-surface-variant)] sm:flex">
                        <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                          {workflowLabel(p.workflow)}
                        </span>
                        {p.status !== 'finalized' && paused.has(p.id) && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 font-semibold text-[var(--pm-tertiary)]" title={t('list.pausedWhy')}>
                            {t('list.paused')}
                          </span>
                        )}
                        {p.status !== 'finalized' && p.stage && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                            {p.stage.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="w-[64px] text-right tabular-nums">
                          {relativeTime(p.updated_at, locale)}
                        </span>
                      </span>
                    </Link>

                    <div className="flex shrink-0 items-center pr-4">
                      {pendingDelete !== p.id && user && (
                        <UseInProjectMenu source={p} userId={user.id} projects={projects ?? []} folders={folders} />
                      )}
                      {pendingDelete !== p.id && (
                        <MoveToMenu projectTitle={p.title} folderId={p.folder_id} folders={folders} onMove={(folderId) => void handleMove(p.id, folderId)} />
                      )}
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
                        <button
                          onClick={() => setPendingDelete(p.id)}
                          aria-label={t('list.deleteNamed', { name: p.title || t('list.aProject') })}
                          className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
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
    </main>
  );
}
