'use client';

import { useEffect, useMemo, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { listFolders } from '@/lib/supabase/folders';
import { listProjects } from '@/lib/supabase/projects';
import { loadProjectForReading, type ProjectForReading } from '@/lib/supabase/reading';
import { isDone } from '@/lib/workflow/types';
import { readingSections, sideChatQuote, stageReadingText } from '@/lib/workflow/reading';
import type { ProjectFolder, ProjectSummary } from '@/types/project';
import { ProjectPicker } from './project-references';

/**
 * Another project, read beside this one (client feedback, 21 Oct, email 4:
 * "dual projects at the same time side-by-side like split screen and you can
 * integrate with each other"). Read-only: the pane loads its own copy and
 * writes nothing to the other project. What crosses over is the user's choice —
 * a section quoted into this project's side chat, or the whole project used as
 * a reference.
 */
export function ProjectReaderPane({
  currentProjectId,
  readingId,
  onChoose,
  onClose,
  onSendToChat,
  onUseAsReference,
  referenced = false,
  referencesFull = false,
}: {
  currentProjectId: string;
  readingId: string | null;
  onChoose: (projectId: string) => void;
  onClose: () => void;
  onSendToChat: (text: string) => void;
  /** Absent when this project cannot take references (read-only, finished). */
  onUseAsReference?: (projectId: string) => Promise<void>;
  referenced?: boolean;
  referencesFull?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ id: string; data: ProjectForReading | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ projects: ProjectSummary[]; folders: ProjectFolder[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sent, setSent] = useState<number | null>(null);

  useEffect(() => {
    if (!readingId) return;
    let live = true;
    loadProjectForReading(readingId)
      .then((data) => {
        if (!live) return;
        setError(null);
        setLoaded({ id: readingId, data });
        setStageId(null);
      })
      .catch((e) => live && setError((e as { message?: string })?.message || 'The project could not be read.'));
    return () => {
      live = false;
    };
  }, [readingId]);

  const showPicker = picking || !readingId;
  useEffect(() => {
    if (!showPicker || choices) return;
    Promise.all([listProjects(200), listFolders().catch(() => [] as ProjectFolder[])])
      .then(([projects, folders]) => setChoices({ projects, folders }))
      .catch((e) => setError((e as { message?: string })?.message || 'Your projects could not be loaded.'));
  }, [showPicker, choices]);

  const data = loaded && loaded.id === readingId ? loaded.data : null;
  const stage = useMemo(() => {
    if (!data) return null;
    const stages = data.template.stages;
    // The stage the other project is on, or its deliverable once it is done.
    return stages.find((s) => s.id === (stageId ?? data.state.current_stage_id)) ?? stages[0] ?? null;
  }, [data, stageId]);
  const sections = useMemo(() => (data && stage ? readingSections(stageReadingText(data.template, stage, data.bundles)) : []), [data, stage]);

  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';

  return (
    <div aria-label="Another project, read beside this one" className="flex h-full min-h-0 flex-col rounded-2xl bg-[var(--surface-container-low)]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">menu_book</span>
        <span className="min-w-0 flex-1 truncate text-title text-[var(--on-surface)]">
          {data ? data.project.title || 'Untitled project' : readingId && !error ? 'Opening…' : 'Read another project'}
        </span>
        <button type="button" onClick={() => setPicking((p) => !p)} className={quiet}>
          {showPicker && readingId ? 'Cancel' : 'Change'}
        </button>
        <button type="button" onClick={onClose} aria-label="Close the other project" className="rounded p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
          <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <p className="px-4 pt-1 text-label text-[var(--on-surface-variant)]">Read-only. Quote a section into the side chat, or use the whole project as a reference.</p>

      {error && <p role="alert" className="px-4 pt-2 text-label text-[var(--pm-error)]">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {showPicker ? (
          choices ? (
            <ProjectPicker
              projects={choices.projects.filter((p) => p.id !== currentProjectId)}
              folders={choices.folders}
              onPick={(id) => {
                setPicking(false);
                onChoose(id);
              }}
            />
          ) : (
            !error && <p className="text-label text-[var(--on-surface-variant)]">Loading your projects…</p>
          )
        ) : loaded && loaded.id === readingId && !data ? (
          <p className="text-body text-[var(--on-surface-variant)]">That project is in the trash or no longer exists.</p>
        ) : data && stage ? (
          <>
            {onUseAsReference && (
              <button
                type="button"
                disabled={referenced || referencesFull || adding}
                onClick={() => {
                  setAdding(true);
                  onUseAsReference(data.project.id)
                    .catch((e) => setError((e as { message?: string })?.message || 'The project could not be added.'))
                    .finally(() => setAdding(false));
                }}
                className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label font-semibold text-[var(--pm-primary)] disabled:opacity-50"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">link</span>
                {referenced ? 'Used as a reference here' : referencesFull ? 'At most 5 references' : adding ? 'Adding…' : 'Use as reference in this project'}
              </button>
            )}

            <nav aria-label="Its stages" className="mb-3 flex flex-wrap gap-1">
              {data.template.stages.map((s) => {
                const status = data.state.stages[s.id]?.status;
                const selected = s.id === stage.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setStageId(s.id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-label ${selected ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'}`}
                  >
                    {isDone(status) && <span aria-label="done" className="material-symbols-outlined text-[14px] text-[var(--pm-success)]">check_circle</span>}
                    {s.id === data.state.current_stage_id && !isDone(status) && <span aria-label="current" className="h-1.5 w-1.5 rounded-full bg-[var(--pm-primary)]" />}
                    {s.short_label || s.label}
                  </button>
                );
              })}
            </nav>

            {sections.length === 0 ? (
              <p className="text-body text-[var(--on-surface-variant)]">Nothing written on {stage.label} yet.</p>
            ) : (
              <ol aria-label={`${stage.label} sections`} className="space-y-3">
                {sections.map((sec, i) => (
                  <li key={i} className="rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3">
                    {sec.heading && <p className="mb-1 text-title text-[var(--on-surface)]">{sec.heading}</p>}
                    {sec.body && <MarkdownOutput content={sec.body} />}
                    <button
                      type="button"
                      onClick={() => {
                        onSendToChat(sideChatQuote(data.project.title, stage.label, sec));
                        setSent(i);
                      }}
                      className={`${quiet} mt-2 inline-flex items-center gap-1`}
                    >
                      <span aria-hidden className="material-symbols-outlined text-[16px]">forum</span>
                      {sent === i ? 'In the side chat — not sent' : 'Send this section to the side chat'}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          !error && <p className="text-label text-[var(--on-surface-variant)]">Opening…</p>
        )}
      </div>
    </div>
  );
}
