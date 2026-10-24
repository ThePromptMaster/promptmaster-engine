'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import { addReference, removeReference, setReferenceFacts } from '@/lib/supabase/references';
import { listFolders } from '@/lib/supabase/folders';
import { listProjects } from '@/lib/supabase/projects';
import { MAX_REFERENCES, type ReferenceMaterial } from '@/lib/workflow/references';
import { useProjectStore } from '@/stores/project-store';
import type { Project, ProjectFolder, ProjectReference, ProjectSummary } from '@/types/project';

/**
 * Other projects this one draws on (client, 21 Oct, email 5: "the project you
 * are working on can use that information from those other chosen files or
 * projects"). Each brings its deliverable as it stands and, unless turned off,
 * its facts; every stage, check and chat is sent them as [R1], [R2], …, below
 * this project's own brief and facts.
 */
export function ProjectReferences({
  project,
  readOnly = false,
  onOpenBeside,
}: {
  project: Pick<Project, 'id' | 'user_id' | 'references'>;
  readOnly?: boolean;
  /** Open a referenced project beside this one (the split view, when it exists). */
  onOpenBeside?: (projectId: string) => void;
}) {
  const t = useT();
  const rows = useProjectStore((s) => s.references);
  const reload = useProjectStore((s) => s.reloadReferences);
  const material = project.references ?? [];
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? rows.length > 0;
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<{ projects: ProjectSummary[]; folders: ProjectFolder[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? fallback));

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
    } catch (e) {
      fail(e, fallback);
    } finally {
      setBusy(false);
    }
  };

  const startPicking = async () => {
    setPicking(true);
    setError(null);
    if (choices) return;
    try {
      const [projects, folders] = await Promise.all([listProjects(200), listFolders().catch(() => [] as ProjectFolder[])]);
      setChoices({ projects, folders });
    } catch (e) {
      fail(e, t('refs.loadError'));
    }
  };

  const taken = new Set([project.id, ...rows.map((r) => r.referenced_project_id)]);
  const full = rows.length >= MAX_REFERENCES;
  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';

  return (
    <section aria-label={t('refs.label')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-start text-title text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">link</span>
        {t('refs.title')}
        <span className="text-label text-[var(--on-surface-variant)]">{rows.length ? t('refs.used', { count: rows.length }) : t('refs.noneUsed')}</span>
        <span aria-hidden className="material-symbols-outlined ms-auto text-[18px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <p className="text-label text-[var(--on-surface-variant)]">
            {t('refs.explain')}
          </p>

          {rows.length > 0 && (
            <ol aria-label={t('refs.listLabel')} className="mt-3 space-y-2">
              {rows.map((r, i) => (
                <ReferenceRow
                  key={r.id}
                  index={i}
                  row={r}
                  material={material.find((m) => m.referenceId === r.id)}
                  readOnly={readOnly}
                  busy={busy}
                  quiet={quiet}
                  onFacts={(value) => void run(() => setReferenceFacts(r.id, value), t('refs.saveError'))}
                  onRemove={() => void run(() => removeReference(r.id), t('refs.removeError'))}
                  onOpenBeside={onOpenBeside}
                />
              ))}
            </ol>
          )}

          {!readOnly && !picking && (
            <button type="button" disabled={busy || full} onClick={() => void startPicking()} className={`${quiet} mt-3`}>
              {full ? t('refs.atMost', { count: MAX_REFERENCES }) : t('refs.useAnother')}
            </button>
          )}

          {picking && (
            <div className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-label font-semibold text-[var(--on-surface)]">{t('refs.which')}</span>
                <button type="button" onClick={() => setPicking(false)} className={quiet}>{t('refs.done')}</button>
              </div>
              {!choices && !error && <p className="text-label text-[var(--on-surface-variant)]">{t('refs.loading')}</p>}
              {choices && (
                <ProjectPicker
                  projects={choices.projects.filter((p) => !taken.has(p.id))}
                  folders={choices.folders}
                  disabled={busy || full}
                  onPick={(id) =>
                    void run(async () => {
                      await addReference(project.user_id, project.id, id);
                    }, t('refs.addError'))
                  }
                />
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        </div>
      )}
    </section>
  );
}

function ReferenceRow({
  index,
  row,
  material,
  readOnly,
  busy,
  quiet,
  onFacts,
  onRemove,
  onOpenBeside,
}: {
  index: number;
  row: ProjectReference;
  material: ReferenceMaterial | undefined;
  readOnly: boolean;
  busy: boolean;
  quiet: string;
  onFacts: (value: boolean) => void;
  onRemove: () => void;
  onOpenBeside?: (projectId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const words = material?.text.trim() ? material.text.trim().split(/\s+/).length : 0;
  const what = material?.deleted
    ? t('refs.inTrash')
    : !material
    ? t('refs.notRead')
    : words
    ? `${t('refs.words', { what: material.deliverable || t('refs.itsWork'), words: words.toLocaleString(locale) })}${row.include_facts ? t('refs.facts', { count: material.facts.length }) : ''}`
    : `${t('refs.nothingYet', { what: material.deliverable || t('refs.itsDeliverable') })}${row.include_facts && material.facts.length ? t('refs.facts', { count: material.facts.length }) : ''}`;
  return (
    <li className="text-body text-[var(--on-surface)]">
      <span className="font-semibold">[R{index + 1}] </span>
      <a href={`/projects/${row.referenced_project_id}`} className="text-[var(--pm-primary)] underline">
        {material?.title ?? t('refs.aProject')}
      </a>
      <span className="block text-label text-[var(--on-surface-variant)]">{what}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="inline-flex items-center gap-1.5 text-label text-[var(--on-surface-variant)]">
          <input
            type="checkbox"
            checked={row.include_facts}
            disabled={readOnly || busy}
            onChange={(e) => onFacts(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--pm-primary)]"
          />
          {t('refs.includeFacts')}
        </label>
        {onOpenBeside && !material?.deleted && (
          <button type="button" onClick={() => onOpenBeside(row.referenced_project_id)} className={`${quiet} hidden md:inline`}>
            {t('refs.openBeside')}
          </button>
        )}
        {!readOnly && (
          <button type="button" disabled={busy} onClick={onRemove} className={quiet}>
            {t('refs.stopUsing')}
          </button>
        )}
      </span>
    </li>
  );
}

/** The user's projects grouped by folder, Unfiled last. */
export function ProjectPicker({
  projects,
  folders,
  disabled,
  onPick,
}: {
  projects: readonly ProjectSummary[];
  folders: readonly ProjectFolder[];
  disabled?: boolean;
  onPick: (projectId: string) => void;
}) {
  const t = useT();
  if (!projects.length) return <p className="text-label text-[var(--on-surface-variant)]">{t('refs.noOthers')}</p>;
  const names = new Map(folders.map((f) => [f.id, f.name]));
  const groups = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const key = p.folder_id && names.has(p.folder_id) ? p.folder_id : '';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (names.get(a) ?? '').localeCompare(names.get(b) ?? '')));
  return (
    <div className="max-h-[320px] space-y-3 overflow-y-auto">
      {ordered.map(([key, rows]) => (
        <div key={key || 'unfiled'}>
          <p className="mb-1 flex items-center gap-1 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            <span aria-hidden className="material-symbols-outlined text-[16px]">{key ? 'folder' : 'inbox'}</span>
            {key ? names.get(key) : groups.size > 1 ? t('refs.unfiled') : t('refs.yours')}
          </p>
          <ul className="space-y-0.5">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p.id)}
                  className="w-full rounded-lg px-2 py-1.5 text-start text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] disabled:opacity-50"
                >
                  <span className="block truncate">{p.title || t('list.untitled')}</span>
                  {p.objective && <span className="block truncate text-label text-[var(--on-surface-variant)]">{p.objective}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
