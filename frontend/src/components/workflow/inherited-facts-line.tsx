'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { inheritedCounts, type Inherited } from '@/lib/folders/inheritance';
import { recordFacts } from '@/lib/supabase/facts';
import { revokeException } from '@/lib/supabase/folder-rules';
import { MismatchChoice } from '@/components/folders/mismatch-choice';
import { useLevelName } from '@/components/folders/level-name';

/**
 * What the project's folders hand down, as one line in the Facts panel (Sean,
 * 23 Nov: "make the inheritance and exceptions easy to see without making
 * people manage settings every time they open a folder").
 *
 * "From your folders: 4 from Client “Acme” · 2 from Search “CFO” · 1
 * different here". Opened, each rule with the folder it came from; a default
 * (never a required rule) can be replaced for this project alone.
 */
export function InheritedFactsLine({
  project,
  inherited,
  readOnly,
  onChanged,
}: {
  project: { id: string; user_id: string; folder_id?: string | null };
  inherited: Inherited | undefined;
  readOnly: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const levelName = useLevelName();
  const [toggled, setToggled] = useState<boolean | null>(null);
  // A mismatch waiting on the user is shown, not folded away (L-280).
  const open = toggled ?? Boolean(inherited?.mismatches.length);
  const setOpen = (next: (v: boolean) => boolean) => setToggled(next(open));
  const [replacing, setReplacing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project.folder_id) return null;
  if (!inherited) {
    return <p className="mb-3 text-label text-[var(--on-surface-variant)]">{t('frules.notRead')}</p>;
  }
  const counts = inheritedCounts(inherited);
  if (!inherited.rules.length && !counts.documents) return null;
  const parts = [
    inherited.mismatches.length ? t('frules.needsChoice', { count: inherited.mismatches.length }) : null,
    inherited.exceptions.length ? t('frules.exceptionCount', { count: inherited.exceptions.length }) : null,
    ...counts.from.map(({ level, count }) => t('frules.lineFrom', { count, level: levelName(level) })),
    counts.differentHere ? t('frules.lineDifferent', { count: counts.differentHere }) : null,
    counts.documents ? t('frules.docCount', { count: counts.documents }) : null,
  ].filter(Boolean);
  const quiet = 'rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40';
  const chip = 'me-1 rounded bg-[var(--surface-container-highest)] px-1.5 py-0.5 text-label text-[var(--on-surface-variant)]';
  const home = inherited.chain.at(-1);

  const replace = async (factId: string, kind: 'fact' | 'requirement', subject: string | null, text: string) => {
    setBusy(true);
    setError(null);
    try {
      await recordFacts(project, [{ statement: text, kind, subject, source_kind: 'brief', overrides_folder_fact: factId }]);
      setReplacing(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ((e as { message?: string })?.message ?? t('frules.saveError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg bg-[var(--surface-container)] px-3 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 text-start text-label text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">rule_folder</span>
        <span className="font-semibold">{t('frules.line')}</span>
        <span className="text-[var(--on-surface-variant)]">{parts.join(' · ')}</span>
        <span aria-hidden className="material-symbols-outlined ms-auto text-[16px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="mt-2">
          {inherited.mismatches.length > 0 && (
            <div className="mb-3 space-y-2">
              {inherited.mismatches.map((m) => (
                <MismatchChoice key={m.conflict.id} mismatch={m} userId={project.user_id} projectId={project.id} onDone={onChanged} />
              ))}
            </div>
          )}
          {inherited.exceptions.length > 0 && (
            <ul aria-label={t('frules.exceptionsHere')} className="mb-3 space-y-1.5">
              {inherited.exceptions.map(({ exception: e, rule, at, ruleChanged }) => (
                <li key={e.id} className="text-body text-[var(--on-surface)]">
                  <span className={chip}>{t('frules.exception')}</span>
                  {t('frules.exceptionLine', { statement: e.statement, rule: rule.fact.statement, level: levelName(rule.level) })}
                  <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                    {at ? `${t('frules.fromLevel', { level: levelName(at) })} · ` : ''}
                    {t('frules.exceptionBy', { who: e.authorised_by, how: e.how_confirmed, why: e.reason })}
                    {ruleChanged ? ` ${t('frules.ruleChanged')}` : ''}
                  </span>
                  {!readOnly && !at && (
                    <button type="button" disabled={busy} className={quiet}
                      onClick={() => void (async () => {
                        setBusy(true);
                        try {
                          await revokeException(e.id);
                          await onChanged();
                        } finally {
                          setBusy(false);
                        }
                      })()}>
                      {t('frules.revoke')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ul className="space-y-1.5">
            {inherited.rules.filter((r) => !r.exceptedBy).map((r) => (
              <li key={r.fact.id} className="text-body text-[var(--on-surface)]">
                <span className={r.replacedBy ? 'text-[var(--on-surface-variant)] line-through' : ''}>
                  {r.fact.required && <span className={chip}>{t('frules.required')}</span>}
                  {r.fact.subject ? `${r.fact.subject}: ` : ''}
                  {r.fact.statement}
                </span>
                <span className="ms-2 text-label text-[var(--on-surface-variant)]">{t('frules.fromLevel', { level: levelName(r.level) })}</span>
                {r.replacedBy && (
                  <span className="mt-0.5 block text-label text-[var(--on-surface)]">
                    {r.replacedBy.at
                      ? t('frules.replacedAt', { level: levelName(r.replacedBy.at), statement: r.replacedBy.statement })
                      : t('frules.replacedProject', { statement: r.replacedBy.statement })}
                  </span>
                )}
                {!readOnly && !r.fact.required && !r.replacedBy && replacing?.id !== r.fact.id && (
                  <button type="button" disabled={busy} className={`ms-1 ${quiet}`} onClick={() => setReplacing({ id: r.fact.id, text: '' })}>
                    {t('frules.replaceProject')}
                  </button>
                )}
                {replacing?.id === r.fact.id && (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={replacing.text}
                      rows={2}
                      aria-label={t('frules.replaceProjectLabel')}
                      placeholder={t('frules.replaceProjectLabel')}
                      onChange={(e) => setReplacing({ ...replacing, text: e.target.value.slice(0, 2_000) })}
                      className="w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !replacing.text.trim()}
                        onClick={() => void replace(r.fact.id, r.fact.kind, r.fact.subject, replacing.text)}
                        className="rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label text-[var(--on-primary)] disabled:opacity-40"
                      >
                        {t('frules.save')}
                      </button>
                      <button type="button" className={quiet} onClick={() => setReplacing(null)}>{t('frules.cancel')}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {inherited.documents.map(({ doc, level }) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 text-body text-[var(--on-surface-variant)]">
                <span aria-hidden className="material-symbols-outlined text-[16px]">description</span>
                {doc.name}
                <span className="text-label">{t('frules.fromLevel', { level: levelName(level) })}</span>
              </li>
            ))}
          </ul>
          {home && (
            <Link href="/projects" onClick={() => { try { window.localStorage.setItem('pm.projectsFolder', home.id); } catch { /* private window */ } }} className={`mt-2 inline-block ${quiet}`}>
              {t('frules.openFolder', { level: levelName(home) })}
            </Link>
          )}
          {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
