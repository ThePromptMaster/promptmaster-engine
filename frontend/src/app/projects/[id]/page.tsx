'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { useProjectStore } from '@/stores/project-store';
import { useProjectFlush } from '@/lib/persistence/use-project-flush';
import { MarkdownOutput } from '@/components/shared/markdown-output';
import { ProjectImagesProvider } from '@/components/shared/project-images';
import { WorkflowWorkspace } from '@/components/workflow/workflow-workspace';
import { getLatestTemplate, getTemplateById } from '@/lib/supabase/workflow';
import type { WorkflowTemplate } from '@/lib/workflow/types';

const SAVE_LABEL: Record<string, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'Changed elsewhere',
  error: 'Not saved',
};

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const storedProject = useProjectStore((s) => s.project);
  const files = useProjectStore((s) => s.files);
  // The data files ride on the project wherever it is handed on, so every
  // prompt built from it knows what data exists.
  const project = useMemo(() => (storedProject ? { ...storedProject, data_files: files } : null), [storedProject, files]);
  const artifact = useProjectStore((s) => s.artifact);
  const versions = useProjectStore((s) => s.versions);
  const stages = useProjectStore((s) => s.stages);
  const evaluations = useProjectStore((s) => s.evaluations);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const saveState = useProjectStore((s) => s.saveState);
  const conflict = useProjectStore((s) => s.conflict);
  const events = useProjectStore((s) => s.events);
  const eventsError = useProjectStore((s) => s.eventsError);
  const refreshEvents = useProjectStore((s) => s.refreshEvents);
  const [retryingEvents, setRetryingEvents] = useState(false);

  const loadProject = useProjectStore((s) => s.loadProject);
  const patchProject = useProjectStore((s) => s.patchProject);
  const resolveConflict = useProjectStore((s) => s.resolveConflict);
  const retrySave = useProjectStore((s) => s.retrySave);
  const appendStageVersion = useProjectStore((s) => s.appendStageVersion);
  const recordStageEvaluation = useProjectStore((s) => s.recordStageEvaluation);
  const restoreStageVersion = useProjectStore((s) => s.restoreStageVersion);
  const setStageSummary = useProjectStore((s) => s.setStageSummary);
  const setStageFigures = useProjectStore((s) => s.setStageFigures);
  const ensureStageArtifact = useProjectStore((s) => s.ensureStageArtifact);

  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  // "Not loaded yet", "failed" and "genuinely missing" are three different
  // pages. With one null for all three, every project opened on "this
  // project's workflow could not be loaded … nothing generated yet" for a
  // moment, and a failed fetch stayed there with no way back (4 Oct).
  const [templateLoad, setTemplateLoad] = useState<'loading' | 'loaded' | 'failed' | 'missing'>('loading');
  const [templateAttempt, setTemplateAttempt] = useState(0);

  useProjectFlush();

  useEffect(() => {
    void loadProject(id);
  }, [id, loadProject]);

  useEffect(() => {
    if (!project) return;
    // Pinned version first; fall back to the latest published one for a project
    // created before templates existed.
    const load = project.workflow_template_id
      ? getTemplateById(project.workflow_template_id)
      : getLatestTemplate(project.workflow);
    let live = true;
    setTemplateLoad('loading');
    load
      .then((t) => {
        if (!live) return;
        setTemplate(t);
        setTemplateLoad(t ? 'loaded' : 'missing');
      })
      .catch(() => {
        if (!live) return;
        setTemplate(null);
        setTemplateLoad('failed');
      });
    return () => {
      live = false;
    };
    // Keyed on the pin, not the project: every keystroke produces a new
    // project object, and re-fetching the template for each one rebuilt every
    // memo in the workspace on every character typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.workflow_template_id, project?.workflow, templateAttempt]);

  if (loading || (storedProject && templateLoad === 'loading')) {
    // A skeleton in the shape of the thing being loaded, rather than the bare
    // "Loading…" string this used to be. The project list one click earlier
    // already shows three shaped cards; arriving here from it and getting a
    // word of grey text read as a broken page, not a loading one. The blocks
    // trace the workspace: the rail on the left, the stage header and body on
    // the right, in the same widths they will settle into.
    return (
      <div className="flex min-h-screen" aria-busy aria-label="Loading project">
        <aside className="hidden w-[248px] shrink-0 bg-[var(--surface-container-lowest)] px-5 py-8 md:block">
          <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface-container-high)]" />
          <div className="mt-2 h-3 w-32 animate-pulse rounded bg-[var(--surface-container-low)]" />
          <div className="mt-7 space-y-2.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-[var(--surface-container-low)]"
              />
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-6 py-10 md:px-10">
          <div className="mx-auto max-w-[820px]">
            <div className="h-8 w-[60%] animate-pulse rounded-lg bg-[var(--surface-container-high)]" />
            <div className="mt-3 h-4 w-[35%] animate-pulse rounded bg-[var(--surface-container-low)]" />
            <div className="mt-10 h-[220px] animate-pulse rounded-2xl bg-[var(--surface-container-low)]" />
            <div className="mt-4 h-[120px] animate-pulse rounded-2xl bg-[var(--surface-container-low)]" />
          </div>
        </main>
      </div>
    );
  }

  if (error && !project) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-16">
        <p className="text-body text-[var(--pm-error)]">{error}</p>
        <Link href="/projects" className="mt-4 inline-block text-body text-[var(--pm-primary)]">
          Back to projects
        </Link>
      </main>
    );
  }

  if (!project) return null;

  // A concurrent edit has to be visible whichever pane is showing — it is a
  // property of the project, not of the single-output view it used to live in.
  // A background reload that failed (after an approval, a drafted section)
  // set `error` but nothing showed it while a project was on screen, so the
  // page silently kept stale state. A save failure has its own label above.
  const refreshBanner =
    error && saveState !== 'error' && !conflict ? (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-body">
        <span className="text-[var(--on-surface)]">
          The latest changes could not be loaded, so this page may be out of date. Nothing has been lost.
        </span>
        <button
          type="button"
          onClick={() => void loadProject(id, { background: true })}
          className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)]"
        >
          Reload
        </button>
      </div>
    ) : null;

  const conflictBanner = conflict ? (
    <div className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4 text-body">
      <p className="text-[var(--on-surface)]">This project was changed in another tab.</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void resolveConflict('reload')}
          className="rounded-lg bg-[var(--surface-container-highest)] px-3 py-2 text-label"
        >
          Reload theirs
        </button>
        <button
          onClick={() => void resolveConflict('keep-mine')}
          className="rounded-lg bg-[var(--pm-primary)] px-3 py-2 text-label text-[var(--on-primary)]"
        >
          Keep my changes
        </button>
      </div>
    </div>
  ) : null;

  const header = (
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <input
        value={project.title}
        onChange={(e) => patchProject({ title: e.target.value })}
        aria-label="Project title"
        className="min-w-0 flex-1 bg-transparent text-headline text-[var(--on-surface)] outline-none"
      />
      <span className="flex shrink-0 items-center gap-2 text-label text-[var(--on-surface-variant)]">
        {SAVE_LABEL[saveState]}
        {saveState === 'error' && (
          // Retries itself a few times; this is for not waiting.
          <button
            type="button"
            onClick={() => void retrySave()}
            className="rounded-md bg-[var(--surface-container-high)] px-2 py-1 text-label text-[var(--on-surface)]"
          >
            Retry now
          </button>
        )}
      </span>
    </div>
  );

  /**
   * A project whose template row cannot be loaded still renders its work.
   *
   * A workflow is a way of organising the project, not a precondition for
   * reading it — and this is the one path that has no stage rail to reach the
   * artifact through, so it shows the head version directly. It is not the old
   * single-output pane: that pane was the *primary* view for a whole workflow
   * and had an objective editor, version pills and evaluation scores in it.
   * Those all live in the workspace now.
   */
  if (templateLoad === 'failed') {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-12">
        <Link
          href="/projects"
          className="mb-8 inline-flex items-center gap-1 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Projects
        </Link>
        {header}
        <div role="alert" className="mt-6 rounded-2xl bg-[var(--surface-container-low)] px-8 py-7">
          <p className="text-title text-[var(--on-surface)]">Couldn&apos;t load this project&apos;s workflow.</p>
          <p className="mt-2 text-body text-[var(--on-surface-variant)]">
            Nothing has been lost — this is a loading problem, not a missing project.
          </p>
          <button
            type="button"
            onClick={() => setTemplateAttempt((n) => n + 1)}
            className="mt-5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)]"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!template) {
    const head = versions.at(-1) ?? null;
    return (
      <main className="mx-auto max-w-[900px] px-6 py-12">
        <Link
          href="/projects"
          className="mb-8 inline-flex items-center gap-1 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Projects
        </Link>
        {header}
        {conflictBanner && <div className="mb-6 mt-6">{conflictBanner}</div>}
        <p className="mb-6 mt-6 text-body text-[var(--on-surface-variant)]">
          This project&apos;s workflow could not be loaded, so its stages are unavailable. The
          latest version of its work is below.
        </p>
        {head ? (
          <article className="rounded-xl bg-[var(--surface-container-lowest)] px-8 py-7">
            <MarkdownOutput content={head.content} />
          </article>
        ) : (
          <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-14 text-center text-body text-[var(--on-surface-variant)]">
            Nothing generated in this project yet.
          </div>
        )}
      </main>
    );
  }

  return (
    <ProjectImagesProvider files={files}>
    <div>
      {/* The header shares an edge with the work below it.
          It used to be a centred max-w-[1200px] row sitting above a workspace
          built from a 248px rail plus a max-w-[820px] column — two different
          grids stacked, so the title floated left of the content it titled and
          nothing on the page lined up with anything else. It now mirrors the
          workspace exactly: the same rail-width gutter, the same padding, the
          same column width. The title starts where the stage content starts. */}
      <div className="bg-[var(--surface-container-lowest)]">
        <div className="flex">
          <div aria-hidden className="hidden w-[248px] shrink-0 md:block" />
          <div className="min-w-0 flex-1 px-6 py-4 md:px-10">
            <div className="max-w-[820px]">
              <div className="flex items-center gap-4">
                <Link
                  href="/projects"
                  aria-label="Back to projects"
                  className="shrink-0 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                >
                  <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                </Link>
                <div className="min-w-0 flex-1">{header}</div>
              </div>
              {conflictBanner && <div className="mt-4">{conflictBanner}</div>}
              {refreshBanner && <div className="mt-4">{refreshBanner}</div>}
            </div>
          </div>
        </div>
      </div>

      {events === null && eventsError ? (
        // Without the log there is no telling where the project stands. Showing
        // the stages anyway would project an empty log — every stage "not
        // started" — which reads as the project having been reset (4 Oct).
        <div className="flex">
          <div aria-hidden className="hidden w-[248px] shrink-0 md:block" />
          <div className="min-w-0 flex-1 px-6 py-10 md:px-10">
            <div role="alert" className="max-w-[820px] rounded-2xl bg-[var(--surface-container-low)] px-8 py-7">
              <p className="text-title text-[var(--on-surface)]">
                Couldn&apos;t load where this project stands.
              </p>
              <p className="mt-2 text-body text-[var(--on-surface-variant)]">
                Its history did not load, so its stages can&apos;t be shown yet. Nothing has been lost:
                your work and every stage&apos;s progress are saved.
              </p>
              <button
                type="button"
                disabled={retryingEvents}
                onClick={() => {
                  setRetryingEvents(true);
                  void refreshEvents()
                    .catch(() => undefined)
                    .finally(() => setRetryingEvents(false));
                }}
                className="mt-5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-60"
              >
                {retryingEvents ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <>
      {/* Every workflow renders through its stages now, single output included.
          The workspace used to take a `children` pane for that one template; it
          does not any more, which is what retired /session. */}
      <WorkflowWorkspace
        project={project}
        artifact={artifact}
        versions={versions}
        stages={stages}
        evaluations={evaluations}
        template={template}
        onPatchProject={patchProject}
        appendStageVersion={appendStageVersion}
        recordStageEvaluation={recordStageEvaluation}
        restoreStageVersion={restoreStageVersion}
        setStageSummary={setStageSummary}
        setStageFigures={setStageFigures}
        ensureStageArtifact={ensureStageArtifact}
        onReload={() => void loadProject(id, { background: true })}
      />
      </>
      )}
    </div>
    </ProjectImagesProvider>
  );
}
