'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { FolderLevel } from '@/lib/folders/inheritance';
import { changedPart, masterChanges } from '@/lib/folders/template-lineage';
import { getTemplateById, listTemplates } from '@/lib/supabase/workflow';
import {
  applyMasterToCopy,
  copyIntoFolder,
  editCopyStage,
  latestWithLineage,
  listFolderTemplates,
  masterUpdate,
  removeFolderTemplate,
  startProjectFrom,
  type FolderTemplateRow,
  type TemplateWithLineage,
} from '@/lib/supabase/folder-templates';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import { useLevelName } from './level-name';

type Template = WorkflowTemplate & { id: string };

interface Shown {
  row: FolderTemplateRow;
  copy: TemplateWithLineage;
  base: Template | null;
  update: { base: Template; master: Template } | null;
  level: FolderLevel;
}

/**
 * The workflows a folder offers (Sean, 23 Nov: "Workspace: shared prompts and
 * editable templates for things like contracts, transcript reviews, and
 * candidate reports ... A client could also have its own templates ... Copy and
 * edit templates at any level. Show which version a copy came from. If the
 * master changes later, show what changed and let the team choose whether to
 * apply it to an active search.").
 *
 * Each is a copy that names the version it came from. A newer master is said,
 * with what changed, and taken into the copy only on a press; a project already
 * on the copy is then offered the new version on its own page.
 */
export function FolderTemplates({ folder, chain }: { folder: { id: string; user_id: string }; chain: readonly FolderLevel[] }) {
  const t = useT();
  const locale = useLocale();
  const levelName = useLevelName();
  const router = useRouter();
  const [here, setHere] = useState<Shown[]>([]);
  const [above, setAbove] = useState<Shown[]>([]);
  const [library, setLibrary] = useState<Template[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; what: 'changes' | 'edit' } | null>(null);
  const [edit, setEdit] = useState<{ stageId: string; text: string }>({ stageId: '', text: '' });
  // "Start a project" asks what it is for first: its first stage drafts itself against that.
  const [starting, setStarting] = useState<{ id: string; template: TemplateWithLineage; goal: string } | null>(null);
  const chainIds = chain.map((l) => l.id).join(',');

  const load = useCallback(async () => {
    const levels = chain.length ? chain : [];
    const rows = await listFolderTemplates(levels.map((l) => l.id));
    const latest = await latestWithLineage(rows.map((r) => r.template_key));
    const shown = await Promise.all(
      rows.flatMap((row) => {
        const copy = latest.get(row.template_key);
        const level = levels.find((l) => l.id === row.folder_id);
        if (!copy || !level) return [];
        return [
          (async (): Promise<Shown> => ({
            row,
            copy,
            level,
            base: copy.copied_from_id ? await getTemplateById(copy.copied_from_id).catch(() => null) : null,
            update: await masterUpdate(copy).catch(() => null),
          }))(),
        ];
      })
    );
    setHere(shown.filter((s) => s.row.folder_id === folder.id));
    setAbove(shown.filter((s) => s.row.folder_id !== folder.id).sort((a, b) => b.level.depth - a.level.depth));
  }, [chain, folder.id]);

  useEffect(() => {
    void load().catch(() => setError(t('ftpl.loadError')));
    listTemplates().then(setLibrary, () => undefined);
    // The chain's ids are the trigger; `load` reads the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainIds, folder.id]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('frules.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';
  const primary = 'rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)] disabled:opacity-40';
  const field = 'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const head = 'text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]';
  const fieldName = (f: string) => (['label', 'entry_prompt_hint', 'entry_guidance'].includes(f) ? t(`ftpl.field.${f}` as never) : t('ftpl.field.other'));

  return (
    <div className="space-y-4">
      <div>
        <h3 className={head}>{t('ftpl.title')}</h3>
        {here.length === 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('ftpl.none')}</p>}
        <ul className="mt-2 space-y-3">
          {here.map((s) => (
            <li key={s.row.id} className="rounded-lg bg-[var(--surface-container)] px-3 py-2 text-body text-[var(--on-surface)]">
              <p className="font-semibold">{t('ftpl.nameVersion', { name: s.copy.name, version: s.copy.version })}</p>
              {s.base && <p className="text-label text-[var(--on-surface-variant)]">{t('ftpl.copiedFrom', { name: s.base.name, version: s.base.version })}</p>}
              {s.update && (
                <p className="mt-1 text-label font-semibold text-[var(--pm-error)]">{t('ftpl.masterChanged', { from: s.update.base.version, to: s.update.master.version })}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                <button type="button" disabled={busy} className={quiet} onClick={() => setStarting({ id: s.row.id, template: s.copy, goal: '' })}>
                  {t('ftpl.start')}
                </button>
                <button type="button" disabled={busy} className={quiet}
                  onClick={() => { setOpen(open?.id === s.row.id && open.what === 'edit' ? null : { id: s.row.id, what: 'edit' }); setEdit({ stageId: s.copy.stages[0]?.id ?? '', text: s.copy.stages[0]?.entry_prompt_hint ?? '' }); }}>
                  {t('ftpl.edit')}
                </button>
                {s.update && (
                  <>
                    <button type="button" disabled={busy} className={quiet} onClick={() => setOpen(open?.id === s.row.id && open.what === 'changes' ? null : { id: s.row.id, what: 'changes' })}>
                      {t('ftpl.whatChanged')}
                    </button>
                    <button type="button" disabled={busy} className={primary}
                      onClick={() => void act(async () => {
                        const { kept } = await applyMasterToCopy(s.copy, folder.user_id);
                        setNote(kept.length ? t('ftpl.appliedKept', { list: kept.map((k) => `${k.label} (${fieldName(k.field)})`).join(', ') }) : t('ftpl.applied'));
                      })}>
                      {t('ftpl.apply')}
                    </button>
                  </>
                )}
                <button type="button" disabled={busy} className={quiet} onClick={() => void act(() => removeFolderTemplate(s.row.id))}>
                  {t('frules.takeOut')}
                </button>
              </div>
              {open?.id === s.row.id && open.what === 'changes' && s.update && (
                <ul className="mt-2 space-y-1.5 text-label">
                  {masterChanges(s.update.base, s.update.master).map((c) => (
                    <li key={`${c.kind}${c.stageId}`}>
                      <span className="font-semibold">{t(`ftpl.change.${c.kind}` as never, { stage: c.label })}</span>
                      {c.fields.map((f) => (
                        <span key={f.field} className="block text-[var(--on-surface-variant)]">
                          {fieldName(f.field)}
                          {f.before !== undefined && f.after !== undefined ? (() => {
                            const part = changedPart(f.before, f.after);
                            return !part.before ? `: ${t('ftpl.addedText', { text: part.after })}` : !part.after ? `: ${t('ftpl.removedText', { text: part.before })}` : `: “${part.before}” → “${part.after}”`;
                          })() : ''}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              {open?.id === s.row.id && open.what === 'edit' && (
                <div className="mt-2 flex flex-col gap-2">
                  <select
                    value={edit.stageId}
                    aria-label={t('ftpl.stage')}
                    onChange={(e) => setEdit({ stageId: e.target.value, text: s.copy.stages.find((x) => x.id === e.target.value)?.entry_prompt_hint ?? '' })}
                    className="rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1 text-label text-[var(--on-surface)]"
                  >
                    {s.copy.stages.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                  </select>
                  <textarea value={edit.text} rows={4} aria-label={t('ftpl.instruction')} onChange={(e) => setEdit({ ...edit, text: e.target.value.slice(0, 4_000) })} className={field} />
                  <div className="flex gap-2">
                    <button type="button" className={primary}
                      disabled={busy || !edit.text.trim() || edit.text === (s.copy.stages.find((x) => x.id === edit.stageId)?.entry_prompt_hint ?? '')}
                      onClick={() => void act(async () => {
                        await editCopyStage(s.copy, edit.stageId, { entry_prompt_hint: edit.text }, folder.user_id);
                        setOpen(null);
                        setNote(t('ftpl.saved', { version: s.copy.version + 1 }));
                      })}>
                      {t('ftpl.saveVersion', { version: s.copy.version + 1 })}
                    </button>
                    <button type="button" className={quiet} onClick={() => setOpen(null)}>{t('frules.cancel')}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('ftpl.addLabel')}
            className="min-w-0 max-w-full rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1 text-label text-[var(--on-surface)]">
            <option value="">{t('ftpl.addLabel')}</option>
            {library.map((w) => <option key={w.id} value={w.id}>{t('ftpl.nameVersion', { name: w.name, version: w.version })}</option>)}
          </select>
          <button type="button" className={primary} disabled={busy || !pick}
            onClick={() => void act(async () => {
              const source = library.find((w) => w.id === pick);
              if (source) await copyIntoFolder(source, folder);
              setPick('');
            })}>
            {t('ftpl.copyHere')}
          </button>
        </div>
      </div>

      {above.length > 0 && (
        <div>
          <h3 className={head}>{t('ftpl.fromAbove')}</h3>
          <ul className="mt-2 space-y-1.5">
            {above.map((s) => (
              <li key={s.row.id} className="text-body text-[var(--on-surface-variant)]">
                {t('ftpl.nameVersion', { name: s.copy.name, version: s.copy.version })}
                <span className="ms-2 text-label">{t('frules.fromLevel', { level: levelName(s.level) })}</span>
                <button type="button" disabled={busy} className={`ms-1 ${quiet}`} onClick={() => setStarting({ id: s.row.id, template: s.copy, goal: '' })}>
                  {t('ftpl.start')}
                </button>
                <button type="button" disabled={busy} className={quiet} onClick={() => void act(() => copyIntoFolder(s.copy, folder))}>
                  {t('ftpl.copyHereShort')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {starting && (
        <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-container)] px-3 py-2">
          <p className="text-label font-semibold text-[var(--on-surface)]">{t('ftpl.startWith', { name: starting.template.name, version: starting.template.version })}</p>
          <textarea value={starting.goal} rows={2} aria-label={t('ftpl.startGoal')} placeholder={t('ftpl.startGoal')}
            onChange={(e) => setStarting({ ...starting, goal: e.target.value.slice(0, 2_000) })} className={field} />
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={busy || !starting.goal.trim()}
              onClick={() => void act(async () => router.push(`/projects/${await startProjectFrom(starting.template, folder, locale, starting.goal)}`))}>
              {t('ftpl.startGo')}
            </button>
            <button type="button" className={quiet} onClick={() => setStarting(null)}>{t('frules.cancel')}</button>
          </div>
        </div>
      )}
      {note && <p className="text-label text-[var(--on-surface)]">{note}</p>}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
    </div>
  );
}
