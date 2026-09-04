'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useAuth } from '@/hooks/use-auth';
import { listProjects, softDeleteProject } from '@/lib/supabase/projects';
import type { ProjectSummary } from '@/types/project';

const WORKFLOW_ICON: Record<string, string> = {
  book: 'menu_book',
  research: 'science',
  single_output: 'bolt',
};

const WORKFLOW_LABEL: Record<string, string> = {
  book: 'Book',
  research: 'Research',
  single_output: 'Single output',
};

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listProjects()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load projects.'));
  }, [user]);

  async function handleDelete(id: string) {
    const previous = projects;
    setProjects((p) => (p ?? []).filter((x) => x.id !== id));
    setPendingDelete(null);
    try {
      await softDeleteProject(id);
    } catch (e) {
      // Put it back rather than leaving the list lying about what exists.
      setProjects(previous);
      setError(e instanceof Error ? e.message : 'Could not delete the project.');
    }
  }

  if (authLoading) return null;

  const active = projects?.filter((p) => p.status !== 'finalized') ?? [];
  const finalized = projects?.filter((p) => p.status === 'finalized') ?? [];

  return (
    <main className="mx-auto max-w-[960px] px-6 py-14">
      <header className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-display text-[var(--on-surface)]">Projects</h1>
          <p className="mt-3 text-body text-[var(--on-surface-variant)]">
            Each one keeps its objective, every version, and what it was judged on.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          New project
        </Link>
      </header>

      {error && (
        <div className="mb-8 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          {error}
        </div>
      )}

      {projects === null && (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[84px] animate-pulse rounded-2xl bg-[var(--surface-container-low)]"
            />
          ))}
        </div>
      )}

      {projects?.length === 0 && (
        <div className="rounded-2xl bg-[var(--surface-container-low)] px-8 py-16 text-center">
          <span
            aria-hidden
            className="material-symbols-outlined text-[32px] text-[var(--on-surface-variant)] opacity-50"
          >
            workspaces
          </span>
          <p className="mt-3 text-headline text-[var(--on-surface)]">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-[420px] text-body text-[var(--on-surface-variant)]">
            Start a project and it will be waiting when you come back — with its versions,
            evaluations and everything you skipped along the way.
          </p>
          <Link
            href="/projects/new"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-5 py-3 text-title text-[var(--on-primary)]"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            New project
          </Link>
        </div>
      )}

      {[
        { key: 'active', label: 'In progress', rows: active },
        { key: 'finalized', label: 'Finished', rows: finalized },
      ].map(({ key, label, rows }) =>
        rows.length === 0 ? null : (
          <section key={key} className="mb-10">
            <h2 className="mb-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
              {label} · {rows.length}
            </h2>

            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.id}>
                  <div className="group relative flex items-center gap-4 rounded-2xl bg-[var(--surface-container-low)] transition-all duration-200 hover:bg-[var(--surface-container-lowest)] hover:shadow-[0_1px_2px_rgba(25,28,30,0.04),0_8px_20px_-10px_rgba(25,28,30,0.2)]">
                    <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-4 px-6 py-5">
                      <span
                        aria-hidden
                        className="material-symbols-outlined shrink-0 text-[22px] text-[var(--on-surface-variant)]"
                      >
                        {WORKFLOW_ICON[p.workflow] ?? 'workspaces'}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-title text-[var(--on-surface)]">
                          {p.title || 'Untitled project'}
                        </span>
                        <span className="mt-1 block truncate text-body text-[var(--on-surface-variant)]">
                          {p.objective || 'No objective yet'}
                        </span>
                      </span>

                      <span className="hidden shrink-0 items-center gap-2 text-label text-[var(--on-surface-variant)] sm:flex">
                        <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                          {WORKFLOW_LABEL[p.workflow] ?? p.workflow}
                        </span>
                        {p.status !== 'finalized' && p.stage && (
                          <span className="rounded-md bg-[var(--surface-container-high)] px-2 py-1">
                            {p.stage.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="w-[64px] text-right tabular-nums">
                          {relativeTime(p.updated_at)}
                        </span>
                      </span>
                    </Link>

                    <div className="shrink-0 pr-4">
                      {pendingDelete === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="rounded-lg bg-[var(--pm-error)] px-3 py-1.5 text-label text-[var(--on-error)]"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setPendingDelete(null)}
                            className="rounded-lg px-2 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setPendingDelete(p.id)}
                          aria-label={`Delete ${p.title || 'project'}`}
                          className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100"
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
    </main>
  );
}
