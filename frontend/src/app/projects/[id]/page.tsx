'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { useProjectStore } from '@/stores/project-store';
import { useProjectFlush } from '@/lib/persistence/use-project-flush';
import { MarkdownOutput } from '@/components/shared/markdown-output';
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

  const project = useProjectStore((s) => s.project);
  const artifact = useProjectStore((s) => s.artifact);
  const versions = useProjectStore((s) => s.versions);
  const stages = useProjectStore((s) => s.stages);
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
  const appendStageVersion = useProjectStore((s) => s.appendStageVersion);
  const restoreStageVersion = useProjectStore((s) => s.restoreStageVersion);
  const setStageSummary = useProjectStore((s) => s.setStageSummary);

  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);

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
    load.then(setTemplate).catch(() => setTemplate(null));
  }, [project]);

  const active = versions.find((v) => v.id === activeVersionId) ?? versions.at(-1) ?? null;
  const evaluation = active ? evaluations[active.id] : undefined;
  const isHead = active?.id === artifact?.current_version_id;

  if (loading) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-16 text-sm text-[var(--on-surface-variant)]">
        Loading…
      </main>
    );
  }

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

  // A concurrent edit has to be visible whichever pane is showing — it is a
  // property of the project, not of the single-output view it used to live in.
  const conflictBanner = conflict ? (
    <div className="mb-6 rounded-xl bg-[var(--surface-container-high)] px-5 py-4 text-sm">
      <p className="text-[var(--on-surface)]">This project was changed in another tab.</p>
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
  ) : null;

  const artifactPane = (
    <>
      {conflictBanner}

      <textarea
        value={project.objective}
        onChange={(e) => patchProject({ objective: e.target.value })}
        aria-label="Objective"
        rows={2}
        placeholder="What are you trying to produce?"
        className="mb-8 w-full resize-none bg-transparent text-[var(--on-surface-variant)] outline-none"
      />

      {versions.length === 0 ? (
        <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-14 text-center text-sm text-[var(--on-surface-variant)]">
          Nothing generated in this project yet.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVersion(v.id)}
                title={v.change_summary ?? v.source_operation}
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
                {active.model && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{active.model}</span>
                  </>
                )}
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
    </>
  );

  const header = (
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <input
        value={project.title}
        onChange={(e) => patchProject({ title: e.target.value })}
        aria-label="Project title"
        className="min-w-0 flex-1 bg-transparent text-[1.5rem] leading-tight tracking-tight text-[var(--on-surface)] outline-none"
      />
      <span className="shrink-0 text-xs text-[var(--on-surface-variant)]">
        {SAVE_LABEL[saveState]}
      </span>
    </div>
  );

  // A project whose template is missing still renders its work — a workflow is
  // a way of organising the project, not a precondition for reading it.
  if (!template) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-12">
        <Link
          href="/projects"
          className="mb-8 inline-flex items-center gap-1 text-sm text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Projects
        </Link>
        {header}
        {artifactPane}
      </main>
    );
  }

  return (
    <div>
      <div className="border-0 bg-[var(--surface-container-lowest)] px-6 py-4 md:px-10">
        <div className="mx-auto flex max-w-[1200px] items-center gap-4">
          <Link
            href="/projects"
            aria-label="Back to projects"
            className="shrink-0 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </Link>
          <div className="min-w-0 flex-1">{header}</div>
        </div>
        {template.key !== 'single_output' && conflictBanner && (
          <div className="mx-auto mt-4 max-w-[1200px]">{conflictBanner}</div>
        )}
      </div>

      {/* Stage renderers own the pane for every workflow that has stages. The
          legacy single-output pane stays only for projects imported from
          /session, which have one artifact and no stage rows; it goes when
          single_output renders through the workspace like everything else. */}
      <WorkflowWorkspace
        project={project}
        artifact={artifact}
        versions={versions}
        stages={stages}
        template={template}
        onPatchProject={patchProject}
        appendStageVersion={appendStageVersion}
        restoreStageVersion={restoreStageVersion}
        setStageSummary={setStageSummary}
      >
        {template.key === 'single_output' ? artifactPane : undefined}
      </WorkflowWorkspace>
    </div>
  );
}
