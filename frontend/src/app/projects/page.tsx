'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { createProject, listProjects, softDeleteProject } from '@/lib/supabase/projects';
import type { ProjectSummary } from '@/types/project';
import { MODE_DISPLAY } from '@/lib/constants';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    listProjects()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load projects.'));
  }, [user]);

  async function handleCreate() {
    if (!user || creating) return;
    setCreating(true);
    try {
      const project = await createProject({}, user.id);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create project.');
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const previous = projects;
    setProjects((p) => (p ?? []).filter((x) => x.id !== id));
    try {
      // Soft delete: recoverable until a scheduled hard delete removes it.
      await softDeleteProject(id);
    } catch (e) {
      setProjects(previous);
      setError(e instanceof Error ? e.message : 'Could not delete project.');
    }
  }

  if (authLoading) return null;

  return (
    <main className="mx-auto max-w-[900px] px-6 py-16">
      <header className="mb-10 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[2.75rem] leading-tight tracking-tight text-[var(--on-surface)]">
            Projects
          </h1>
          <p className="mt-2 text-sm text-[var(--on-surface-variant)]">
            Every project keeps its objective, versions and evaluations.
          </p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-5 py-3 text-sm font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          New project
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded-lg bg-[var(--pm-error)]/10 px-4 py-3 text-sm text-[var(--pm-error)]">
          {error}
        </div>
      )}

      {projects === null && (
        <p className="text-sm text-[var(--on-surface-variant)]">Loading…</p>
      )}

      {projects?.length === 0 && (
        <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-14 text-center">
          <p className="text-[var(--on-surface)]">No projects yet.</p>
          <p className="mt-1 text-sm text-[var(--on-surface-variant)]">
            Start one and it will be here when you come back.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {projects?.map((p) => (
          <li
            key={p.id}
            className="group flex items-center gap-4 rounded-xl bg-[var(--surface-container-low)] px-6 py-5 transition-colors hover:bg-[var(--surface-container)]"
          >
            <Link href={`/projects/${p.id}`} className="min-w-0 flex-1">
              <div className="truncate text-[var(--on-surface)]">
                {p.title || 'Untitled project'}
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-[var(--on-surface-variant)]">
                <span>{MODE_DISPLAY[p.mode]?.display_name ?? p.mode}</span>
                <span aria-hidden>·</span>
                <span>{p.status === 'finalized' ? 'Finalized' : `Stage: ${p.stage}`}</span>
                <span aria-hidden>·</span>
                <span>{relativeTime(p.updated_at)}</span>
              </div>
            </Link>
            <button
              onClick={() => handleDelete(p.id)}
              aria-label={`Delete ${p.title || 'project'}`}
              className="shrink-0 rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] group-hover:opacity-100"
            >
              <span className="material-symbols-outlined text-[20px]">delete</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
