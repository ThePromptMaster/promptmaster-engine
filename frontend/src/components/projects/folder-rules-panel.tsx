'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { DOCUMENT_EXTENSIONS, extractText } from '@/lib/data/extract-text';
import { resolveInherited, type RuleAtLevel } from '@/lib/folders/inheritance';
import {
  addFolderDocument,
  addFolderFact,
  readInherited,
  recordConflicts,
  retireFolderDocument,
  retireFolderFact,
  revokeException,
  supersedeFolderFact,
  type InheritedSource,
} from '@/lib/supabase/folder-rules';
import { api } from '@/lib/api/client';
import { levelWords, type Inherited } from '@/lib/folders/inheritance';
import { MismatchChoice } from '@/components/folders/mismatch-choice';
import type { FolderFact } from '@/types/project';
import { setFolderKind } from '@/lib/supabase/folders';
import { folderKey } from '@/lib/folders/inputs-used';
import { projectsNeedingAnotherLook } from '@/lib/supabase/folder-rules';
import Link from 'next/link';
import type { FolderKind, ProjectFolder } from '@/types/project';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { useLevelName } from '@/components/folders/level-name';

const KINDS: FolderKind[] = ['workspace', 'client', 'search', 'folder'];

/**
 * A folder's rules and documents, and what it inherits (Sean, 23 Nov: "A
 * folder should be able to show what it inherits, where it came from, and
 * what's different here").
 *
 * One line until opened, so nobody manages settings to open a folder: what is
 * set here, how much comes from above, how many documents. Opened, it lists
 * them, with the folder each came from.
 */
export function FolderRulesPanel({
  folder,
  onKindChanged,
  projects = [],
}: {
  folder: ProjectFolder;
  onKindChanged: () => void;
  /** The projects listed in this folder: those with work made under earlier rules are named (L-281). */
  projects?: readonly { id: string; title: string }[];
}) {
  const t = useT();
  const levelName = useLevelName();
  const [source, setSource] = useState<InheritedSource | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [required, setRequired] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string; required: boolean } | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    readInherited(folder.id, false)
      .then((s) => {
        setSource(s);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, [folder.id]);

  useEffect(() => {
    setSource(null);
    setOpen(false);
    load();
  }, [load]);
  // Something here disagrees with a rule from above: shown, not left folded away.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!opened && source && (resolveInherited({ ...source, folderId: folder.id }).mismatches.some((m) => m.lower.kind === 'folder' && m.lower.rule.level.id === folder.id))) {
      setOpen(true);
      setOpened(true);
    }
  }, [source, folder.id, opened]);

  const inh = useMemo(() => (source ? resolveInherited({ ...source, folderId: folder.id }) : null), [source, folder.id]);
  // Work made under earlier rules, flagged without opening anything (Sean, 23 Nov: "flag earlier
  // reviews that may need another look"; L-281).
  const [stale, setStale] = useState<Set<string>>(new Set());
  const projectIds = projects.map((p) => p.id).join(',');
  const key = folderKey(inh);
  useEffect(() => {
    if (!key || !projectIds) {
      setStale(new Set());
      return;
    }
    let live = true;
    projectsNeedingAnotherLook(projectIds.split(','), key).then((s) => live && setStale(s), () => undefined);
    return () => {
      live = false;
    };
  }, [key, projectIds]);
  const needLook = projects.filter((p) => stale.has(p.id));
  const here = inh?.chain.at(-1);
  const setHere = (inh?.rules ?? []).filter((r) => r.level.id === folder.id);
  const fromAbove = (inh?.rules ?? []).filter((r) => r.level.id !== folder.id);
  const docsHere = (inh?.documents ?? []).filter((d) => d.level.id === folder.id);
  const docsAbove = (inh?.documents ?? []).filter((d) => d.level.id !== folder.id);
  const ignoredHere = (inh?.ignored ?? []).filter((i) => i.why === 'now_required' && i.at?.id === folder.id);
  // What was said here and disagrees with a rule from above, waiting on the user (L-280).
  const mismatchesHere = (inh?.mismatches ?? []).filter((m) => m.lower.kind === 'folder' && m.lower.rule.level.id === folder.id);
  const exceptionsHere = (inh?.exceptions ?? []).filter((e) => e.at?.id === folder.id);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ((e as { message?: string })?.message ?? t('frules.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: FileList | null) => {
    const picked = [...(files ?? [])];
    if (!picked.length) return;
    await act(async () => {
      for (const file of picked) {
        const read = await extractText(file.name, await file.arrayBuffer());
        if ('error' in read) throw new Error(read.error);
        await addFolderDocument(folder, { name: file.name, text: read.text, source_ref: { file: file.name, size: file.size, chars: read.text.length } });
      }
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  // A rule added here is read against the rules handed down from above; what
  // cannot both hold is recorded and put to the user (Sean, 23 Nov: "surface both").
  const checkAgainstAbove = async (made: FolderFact, resolved: Inherited | null) => {
    const above = (resolved?.rules ?? []).filter((r) => r.level.id !== folder.id && !r.replacedBy && !r.exceptedBy);
    const at = resolved?.chain.at(-1);
    if (!above.length || !at) return;
    try {
      const res = await api.inheritedMismatches({
        rules: above.slice(0, 100).map((r) => ({ id: r.fact.id, statement: r.fact.statement, scope: levelWords(r.level), required: r.fact.required })),
        statements: [{ id: made.id, statement: made.statement, place: levelWords(at), kind: 'new' }],
      });
      await recordConflicts(made.user_id, res.mismatches.map((m) => ({
        upper_fact_id: m.rule_id, lower_folder_fact_id: m.statement_id, upper_quote: m.rule_quote, lower_quote: m.statement_quote, explanation: m.explanation ?? '',
      })));
    } catch {
      // The rule is saved; a check that did not run finds nothing, and both still show here.
    }
  };

  const field =
    'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';
  const primary = 'rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)] disabled:opacity-40';
  const chip = 'me-1 rounded bg-[var(--surface-container-highest)] px-1.5 py-0.5 text-label text-[var(--on-surface-variant)]';

  const words = (n: number) => Math.max(1, Math.round(n / 6));

  const ruleText = (r: RuleAtLevel) => (
    <>
      {r.fact.required && <span className={chip}>{t('frules.required')}</span>}
      {r.fact.subject ? `${r.fact.subject}: ` : ''}
      {r.fact.statement}
    </>
  );

  const summary = [
    mismatchesHere.length ? t('frules.needsChoice', { count: mismatchesHere.length }) : null,
    needLook.length ? t('evid.needLook', { count: needLook.length }) : null,
    here?.kind ? t(`frules.kind.${here.kind}` as MessageKey) : null,
    t('frules.setHereCount', { count: setHere.length }),
    fromAbove.length ? t('frules.fromAboveCount', { count: fromAbove.length }) : null,
    docsHere.length + docsAbove.length ? t('frules.docCount', { count: docsHere.length + docsAbove.length }) : null,
  ].filter(Boolean);

  return (
    <section aria-label={t('frules.label')} className="mb-8 rounded-2xl bg-[var(--surface-container-low)] px-5 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-start text-title text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">rule_folder</span>
        {t('frules.title')}
        <span className="text-label text-[var(--on-surface-variant)]">{loadFailed ? t('frules.loadError') : source ? summary.join(' · ') : t('frules.loading')}</span>
        <span aria-hidden className="material-symbols-outlined ms-auto text-[18px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && source && (
        <div className="mt-3 space-y-5">
          <p className="text-label leading-snug text-[var(--on-surface-variant)]">{t('frules.explain')}</p>

          {mismatchesHere.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--pm-error)]">{t('frules.needsChoice', { count: mismatchesHere.length })}</h3>
              {mismatchesHere.map((m) => (
                <MismatchChoice key={m.conflict.id} mismatch={m} userId={folder.user_id} onDone={load} />
              ))}
            </div>
          )}

          {needLook.length > 0 && (
            <div>
              <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('evid.needLook', { count: needLook.length })}</h3>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.needLookExplain')}</p>
              <ul className="mt-1 space-y-0.5">
                {needLook.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className={quiet}>{p.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {exceptionsHere.length > 0 && (
            <div>
              <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('frules.exceptionsHere')}</h3>
              <ul className="mt-2 space-y-2">
                {exceptionsHere.map(({ exception: e, rule, ruleChanged }) => (
                  <li key={e.id} className="text-body text-[var(--on-surface)]">
                    {t('frules.exceptionLine', { statement: e.statement, rule: rule.fact.statement, level: levelName(rule.level) })}
                    <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                      {t('frules.exceptionBy', { who: e.authorised_by, how: e.how_confirmed, why: e.reason })}
                      {ruleChanged ? ` ${t('frules.ruleChanged')}` : ''}
                    </span>
                    <button type="button" disabled={busy} className={quiet} onClick={() => void act(() => revokeException(e.id))}>
                      {t('frules.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="flex flex-wrap items-center gap-2 text-label text-[var(--on-surface-variant)]">
            {t('frules.kindLabel')}
            <select
              value={folder.kind ?? ''}
              disabled={busy}
              onChange={(e) => void act(async () => {
                await setFolderKind(folder.id, (e.target.value || null) as FolderKind | null);
                onKindChanged();
              })}
              className="rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1 text-label text-[var(--on-surface)]"
            >
              <option value="">{t('frules.kind.none')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{t(`frules.kind.${k}` as MessageKey)}</option>
              ))}
            </select>
          </label>

          <div>
            <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('frules.setHere')}</h3>
            {setHere.length === 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('frules.noneHere')}</p>}
            <ul className="mt-2 space-y-2">
              {setHere.map((r) => (
                <li key={r.fact.id} className="text-body text-[var(--on-surface)]">
                  {editing?.id === r.fact.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea value={editing.text} rows={2} aria-label={t('frules.changeLabel')} className={field}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, 2_000) })} />
                      <div className="flex flex-wrap items-center gap-2">
                        {!r.replaces && (
                          <label className="flex items-center gap-1.5 text-label text-[var(--on-surface-variant)]">
                            <input type="checkbox" checked={editing.required} onChange={(e) => setEditing({ ...editing, required: e.target.checked })} />
                            {t('frules.requiredHint')}
                          </label>
                        )}
                        <button type="button" className={primary}
                          disabled={busy || !editing.text.trim() || (editing.text.trim() === r.fact.statement && editing.required === r.fact.required)}
                          onClick={() => void act(async () => {
                            await supersedeFolderFact(r.fact, editing.text, r.replaces ? false : editing.required);
                            setEditing(null);
                          })}>
                          {t('frules.save')}
                        </button>
                        <button type="button" className={quiet} onClick={() => setEditing(null)}>{t('frules.cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {ruleText(r)}
                      {r.replaces && (
                        <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                          {t('frules.replaces', { level: levelName(r.replaces.level), statement: r.replaces.fact.statement })}
                        </span>
                      )}
                      <button type="button" disabled={busy} className={`ms-2 ${quiet}`}
                        onClick={() => setEditing({ id: r.fact.id, text: r.fact.statement, required: r.fact.required })}>
                        {t('frules.change')}
                      </button>
                      <button type="button" disabled={busy} className={quiet}
                        onClick={() => void act(() => retireFolderFact(r.fact.id, 'taken out by the user'))}>
                        {t('frules.takeOut')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {ignoredHere.map((i) => (
              <p key={i.id} className="mt-2 text-label text-[var(--on-surface-variant)]">{t('frules.nowRequired', { statement: i.statement })}</p>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              <textarea value={adding} rows={2} aria-label={t('frules.addLabel')} placeholder={t('frules.addHint')} className={field}
                onChange={(e) => setAdding(e.target.value.slice(0, 2_000))} />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-label text-[var(--on-surface-variant)]">
                  <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                  {t('frules.requiredHint')}
                </label>
                <button type="button" className={primary} disabled={busy || !adding.trim()}
                  onClick={() => void act(async () => {
                    const made = await addFolderFact(folder, { statement: adding, required, kind: 'requirement' });
                    setAdding('');
                    setRequired(false);
                    await checkAgainstAbove(made, inh);
                  })}>
                  {busy ? t('frules.saving') : t('frules.add')}
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('frules.documents')}</h3>
            {docsHere.length === 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('frules.noDocs')}</p>}
            <ul className="mt-2 space-y-1">
              {docsHere.map(({ doc }) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-2 text-body text-[var(--on-surface)]">
                  <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">description</span>
                  {doc.name}
                  {typeof doc.source_ref?.chars === 'number' && (
                    <span className="text-label text-[var(--on-surface-variant)]">{t('frules.docWords', { words: words(doc.source_ref.chars) })}</span>
                  )}
                  <button type="button" disabled={busy} className={quiet} onClick={() => void act(() => retireFolderDocument(doc.id))}>
                    {t('frules.takeOut')}
                  </button>
                </li>
              ))}
            </ul>
            <input ref={fileInput} type="file" multiple accept={DOCUMENT_EXTENSIONS.join(',')} className="hidden" aria-label={t('frules.addDocument')}
              onChange={(e) => void attach(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={`mt-2 ${quiet}`}>
              {busy ? t('frules.reading') : t('frules.addDocument')}
            </button>
          </div>

          {(fromAbove.length > 0 || docsAbove.length > 0) && (
            <div>
              <h3 className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('frules.fromAbove')}</h3>
              <ul className="mt-2 space-y-2">
                {fromAbove.map((r) => (
                  <li key={r.fact.id} className="text-body text-[var(--on-surface-variant)]">
                    <span className={r.replacedBy || r.exceptedBy ? 'line-through' : ''}>{ruleText(r)}</span>
                    <span className="ms-2 text-label">{t('frules.fromLevel', { level: levelName(r.level) })}</span>
                    {r.replacedBy && (
                      <span className="mt-0.5 block text-label text-[var(--on-surface)]">
                        {r.replacedBy.at?.id === folder.id
                          ? t('frules.replacedHere', { statement: r.replacedBy.statement })
                          : t('frules.replacedAt', { level: r.replacedBy.at ? levelName(r.replacedBy.at) : '', statement: r.replacedBy.statement })}
                        {r.replacedBy.defaultChanged ? ` ${t('frules.defaultChanged')}` : ''}
                      </span>
                    )}
                    {r.exceptedBy && (
                      <span className="mt-0.5 block text-label text-[var(--on-surface)]">
                        {t('frules.exceptedAt', { level: r.exceptedBy.at ? levelName(r.exceptedBy.at) : t('frules.thisProjectCap'), statement: r.exceptedBy.exception.statement })}
                      </span>
                    )}
                    {!r.fact.required && !r.replacedBy && !r.exceptedBy && replacing?.id !== r.fact.id && (
                      <button type="button" disabled={busy} className={`ms-2 ${quiet}`} onClick={() => setReplacing({ id: r.fact.id, text: '' })}>
                        {t('frules.replaceHere')}
                      </button>
                    )}
                    {replacing?.id === r.fact.id && (
                      <div className="mt-2 flex flex-col gap-2">
                        <textarea value={replacing.text} rows={2} aria-label={t('frules.replaceLabel')} placeholder={t('frules.replaceLabel')} className={field}
                          onChange={(e) => setReplacing({ ...replacing, text: e.target.value.slice(0, 2_000) })} />
                        <div className="flex gap-2">
                          <button type="button" className={primary} disabled={busy || !replacing.text.trim()}
                            onClick={() => void act(async () => {
                              await addFolderFact(folder, { statement: replacing.text, kind: r.fact.kind, subject: r.fact.subject, overrides: r.fact.id });
                              setReplacing(null);
                            })}>
                            {t('frules.save')}
                          </button>
                          <button type="button" className={quiet} onClick={() => setReplacing(null)}>{t('frules.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {docsAbove.map(({ doc, level }) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 text-body text-[var(--on-surface-variant)]">
                    <span aria-hidden className="material-symbols-outlined text-[16px]">description</span>
                    {doc.name}
                    <span className="text-label">{t('frules.fromLevel', { level: levelName(level) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
        </div>
      )}
    </section>
  );
}
