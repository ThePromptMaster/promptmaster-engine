'use client';

import { stageText } from '@/lib/i18n/templates';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
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
  const t = useT();
  const locale = useLocale();
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
      .catch((e) => live && setError((e as { message?: string })?.message || t('reader.readError')));
    return () => {
      live = false;
    };
  }, [readingId, t]);

  const showPicker = picking || !readingId;
  useEffect(() => {
    if (!showPicker || choices) return;
    Promise.all([listProjects(200), listFolders().catch(() => [] as ProjectFolder[])])
      .then(([projects, folders]) => setChoices({ projects, folders }))
      .catch((e) => setError((e as { message?: string })?.message || t('refs.loadError')));
  }, [showPicker, choices, t]);

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
    <div aria-label={t('reader.label')} className="flex h-full min-h-0 flex-col rounded-2xl bg-[var(--surface-container-low)]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">menu_book</span>
        <span className="min-w-0 flex-1 truncate text-title text-[var(--on-surface)]">
          {data ? data.project.title || t('list.untitled') : readingId && !error ? t('reader.opening') : t('reader.readAnother')}
        </span>
        <button type="button" onClick={() => setPicking((p) => !p)} className={quiet}>
          {showPicker && readingId ? t('reader.cancel') : t('reader.change')}
        </button>
        <button type="button" onClick={onClose} aria-label={t('reader.close')} className="rounded p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
          <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <p className="px-4 pt-1 text-label text-[var(--on-surface-variant)]">{t('reader.note')}</p>

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
            !error && <p className="text-label text-[var(--on-surface-variant)]">{t('refs.loading')}</p>
          )
        ) : loaded && loaded.id === readingId && !data ? (
          <p className="text-body text-[var(--on-surface-variant)]">{t('reader.gone')}</p>
        ) : data && stage ? (
          <>
            {onUseAsReference && (
              <button
                type="button"
                disabled={referenced || referencesFull || adding}
                onClick={() => {
                  setAdding(true);
                  onUseAsReference(data.project.id)
                    .catch((e) => setError((e as { message?: string })?.message || t('refs.addError')))
                    .finally(() => setAdding(false));
                }}
                className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label font-semibold text-[var(--pm-primary)] disabled:opacity-50"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">link</span>
                {referenced ? t('reader.used') : referencesFull ? t('reader.full') : adding ? t('reader.adding') : t('reader.use')}
              </button>
            )}

            <nav aria-label={t('reader.stages')} className="mb-3 flex flex-wrap gap-1">
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
                    {isDone(status) && <span aria-label={t('reader.done')} className="material-symbols-outlined text-[14px] text-[var(--pm-success)]">check_circle</span>}
                    {s.id === data.state.current_stage_id && !isDone(status) && <span aria-label={t('reader.current')} className="h-1.5 w-1.5 rounded-full bg-[var(--pm-primary)]" />}
                    {stageText(locale, data.template.key, s, 'short') || stageText(locale, data.template.key, s, 'label')}
                  </button>
                );
              })}
            </nav>

            {sections.length === 0 ? (
              <p className="text-body text-[var(--on-surface-variant)]">{t('reader.nothing', { stage: stageText(locale, data.template.key, stage, 'label') })}</p>
            ) : (
              <ol aria-label={t('reader.sections', { stage: stageText(locale, data.template.key, stage, 'label') })} className="space-y-3">
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
                      {sent === i ? t('reader.sent') : t('reader.send')}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          !error && <p className="text-label text-[var(--on-surface-variant)]">{t('reader.opening')}</p>
        )}
      </div>
    </div>
  );
}
