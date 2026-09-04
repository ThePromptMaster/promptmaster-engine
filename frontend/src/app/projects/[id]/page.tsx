'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';

import { useProjectStore } from '@/stores/project-store';
import { useProjectFlush } from '@/lib/persistence/use-project-flush';
import { MarkdownOutput } from '@/components/shared/markdown-output';

const SAVE_LABEL: Record<string, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'Changed elsewhere',
  error: 'Not saved',
};

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const project = useProjectStore((s) => s.project);
  const artifact = useProjectStore((s) => s.artifact);
  const versions = useProjectStore((s) => s.versions);
  const evaluations = useProjectStore((s) => s.evaluations);
  const activeVersionId = useProjectStore((s) => s.activeVersionId);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const saveState = useProjectStore((s) => s.saveState);
  const conflict = useProjectStore((s) => s.conflict);

  const loadProject = useProjectStore((s) => s.loadProject);
  const patchProject = useProjectStore((s) => s.patchProject);
  const setActiveVersion = useProjectStore((s) => s.setActiveVersion);
  const restoreVersion = useProjectStore((s) => s.restoreVersion);
  const resolveConflict = useProjectStore((s) => s.resolveConflict);

  useProjectFlush();

  useEffect(() => {
    void loadProject(id);
  }, [id, loadProject]);

  const active = versions.find((v) => v.id === activeVersionId) ?? versions.at(-1) ?? null;
  const evaluation = active ? evaluations[active.id] : undefined;
  const isHead = active?.id === artifact?.current_version_id;

  if (loading) return <main className="mx-auto max-w-[900px] px-6 py-16 text-sm text-[var(--on-surface-variant)]">Loading…</main>;

  if (error && !project) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-16">
        <p className="text-sm text-[var(--pm-error)]">{error}</p>
        <Link href="/projects" className="mt-4 inline-block text-sm text-[var(--pm-primary)]">
          Back to projects
        </Link>
      </main>
    );
  }

  if (!project) return null;

  return (
    <main className="mx-auto max-w-[900px] px-6 py-12">
      <Link
        href="/projects"
        className="mb-8 inline-flex items-center gap-1 text-sm text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Projects
      </Link>

      <div className="mb-2 flex items-baseline justify-between gap-4">
        <input
          value={project.title}
          onChange={(e) => patchProject({ title: e.target.value })}
          aria-label="Project title"
          className="min-w-0 flex-1 bg-transparent text-[2.25rem] leading-tight tracking-tight text-[var(--on-surface)] outline-none"
        />
        <span className="shrink-0 text-xs text-[var(--on-surface-variant)]">
          {SAVE_LABEL[saveState]}
        </span>
      </div>

      {conflict && (
        <div className="mb-6 rounded-lg bg-[var(--surface-container-high)] px-4 py-3 text-sm">
          <p className="text-[var(--on-surface)]">
            This project was changed in another tab.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void resolveConflict('reload')}
              className="rounded-lg bg-[var(--surface-container-highest)] px-3 py-2 text-xs"
            >
              Reload theirs
            </button>
            <button
              onClick={() => void resolveConflict('keep-mine')}
              className="rounded-lg bg-[var(--pm-primary)] px-3 py-2 text-xs text-[var(--on-primary)]"
            >
              Keep my changes
            </button>
          </div>
        </div>
      )}

      <textarea
        value={project.objective}
        onChange={(e) => patchProject({ objective: e.target.value })}
        aria-label="Objective"
        rows={2}
        className="mb-10 w-full resize-none bg-transparent text-[var(--on-surface-variant)] outline-none"
        placeholder="What are you trying to produce?"
      />

      {versions.length === 0 ? (
        <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-14 text-center text-sm text-[var(--on-surface-variant)]">
          No versions yet.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVersion(v.id)}
                className={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  v.id === active?.id
                    ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                    : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'
                }`}
              >
                v{v.version_number}
                {v.restored_from_version_id && ' ↩'}
              </button>
            ))}
            {active && !isHead && (
              <button
                onClick={() => void restoreVersion(active.id)}
                className="ml-auto rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-xs text-[var(--on-surface)]"
              >
                Restore v{active.version_number}
              </button>
            )}
          </div>

          {active && (
            <article className="rounded-xl bg-[var(--surface-container-lowest)] px-8 py-7">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-[var(--on-surface-variant)]">
                <span>{active.source_operation}</span>
                {active.model && <><span aria-hidden>·</span><span>{active.model}</span></>}
                {evaluation && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Alignment {evaluation.alignment_score}</span>
                    <span>Drift {evaluation.drift_score}</span>
                    <span>Clarity {evaluation.clarity_score}</span>
                  </>
                )}
              </div>
              {active.change_summary && (
                <p className="mb-5 text-sm italic text-[var(--on-surface-variant)]">
                  {active.change_summary}
                </p>
              )}
              <MarkdownOutput content={active.content} />
            </article>
          )}
        </>
      )}
    </main>
  );
}
