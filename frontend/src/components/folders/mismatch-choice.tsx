'use client';

import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { lowerStatement } from '@/lib/folders/holds';
import type { FolderLevel, OpenMismatch } from '@/lib/folders/inheritance';
import { addFolderFact, dismissConflict, recordException, retireFolderFact, supersedeFolderFact } from '@/lib/supabase/folder-rules';
import { recordFacts, retireFact } from '@/lib/supabase/facts';
import { useLevelName } from '@/components/folders/level-name';

/**
 * Two instructions that cannot both hold: a folder's rule and something said
 * lower down (Sean, 23 Nov: "surface both and offer something like Apply
 * exception to this search. That would record who confirmed it and why.").
 *
 * Both are shown with where each was set. The choices: an exception for the
 * place the note was made (who authorised it, how that was confirmed, why);
 * correcting the rule where it is set, for everything below it; following the
 * rule here; replacing a default (never a required rule) here; or saying they
 * do not disagree. Nothing here is chosen for the user, by Go or anything else.
 */
export function MismatchChoice({
  mismatch,
  userId,
  projectId,
  onDone,
}: {
  mismatch: OpenMismatch;
  userId: string;
  /** The project, when the note is one of its facts: an exception then applies to it. */
  projectId?: string | null;
  onDone: () => void | Promise<void>;
}) {
  const t = useT();
  const levelName = useLevelName();
  const [mode, setMode] = useState<'choose' | 'exception' | 'correct'>('choose');
  const [who, setWho] = useState('');
  const [how, setHow] = useState('');
  const [why, setWhy] = useState('');
  const [what, setWhat] = useState(lowerStatement(mismatch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upper = mismatch.upper;
  const lowerLevel: FolderLevel | null = mismatch.lower.kind === 'folder' ? mismatch.lower.rule.level : null;
  const place = lowerLevel ? t(`frules.this.${lowerLevel.kind ?? 'folder'}` as MessageKey) : t('frules.thisProject');
  const lowerSaid = lowerLevel ? levelName(lowerLevel) : t('frules.thisProjectCap');

  const retireLower = async (why: string) => {
    if (mismatch.lower.kind === 'folder') await retireFolderFact(mismatch.lower.rule.fact.id, why);
    else await retireFact(mismatch.lower.fact.id, why);
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onDone();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ((e as { message?: string })?.message ?? t('frules.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const ready = who.trim().length >= 2 && how.trim().length >= 4 && why.trim().length >= 4 && what.trim().length > 0;
  const field =
    'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const choice = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-40';
  const primary = 'rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label font-semibold text-[var(--on-primary)] disabled:opacity-40';
  const quote = 'mt-1 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)]';

  return (
    <div role="group" aria-label={t('frules.mmTitle')} className="rounded-xl bg-[var(--surface-container)] px-4 py-3">
      <p className="flex items-center gap-1.5 text-label font-semibold text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--pm-error)]">sync_problem</span>
        {t('frules.mmTitle')}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <p className="text-label text-[var(--on-surface-variant)]">
            {t('frules.mmSays', { level: levelName(upper.level) })}
            {upper.fact.required ? ` · ${t('frules.required')}` : ''}
          </p>
          <p className={quote}>{upper.fact.statement}</p>
        </div>
        <div>
          <p className="text-label text-[var(--on-surface-variant)]">{t('frules.mmSays', { level: lowerSaid })}</p>
          <p className={quote}>{lowerStatement(mismatch)}</p>
        </div>
      </div>
      {mismatch.conflict.explanation && <p className="mt-2 text-label text-[var(--on-surface-variant)]">{mismatch.conflict.explanation}</p>}

      {mode === 'choose' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={primary} onClick={() => setMode('exception')}>
            {t('frules.mmException', { place })}
          </button>
          <button type="button" disabled={busy} className={choice} onClick={() => setMode('correct')}>
            {t('frules.mmCorrect', { level: levelName(upper.level) })}
          </button>
          <button type="button" disabled={busy} className={choice}
            onClick={() => void act(() => retireLower(`kept the rule of ${upper.level.name}`))}>
            {t('frules.mmKeep', { level: levelName(upper.level) })}
          </button>
          {!upper.fact.required && (
            <button type="button" disabled={busy} className={choice}
              onClick={() => void act(async () => {
                if (mismatch.lower.kind === 'folder') {
                  const lower = mismatch.lower.rule;
                  await addFolderFact({ id: lower.fact.folder_id, user_id: lower.fact.user_id }, {
                    statement: lower.fact.statement, kind: upper.fact.kind, subject: upper.fact.subject, overrides: upper.fact.id,
                  });
                } else {
                  const f = mismatch.lower.fact;
                  await recordFacts({ id: f.project_id, user_id: f.user_id }, [{ statement: f.statement, kind: f.kind, subject: f.subject, source_kind: 'brief', overrides_folder_fact: upper.fact.id }]);
                }
                await retireLower('replaced the default here');
              })}>
              {t('frules.mmDiffers', { place })}
            </button>
          )}
          <button type="button" disabled={busy} className={choice} onClick={() => void act(() => dismissConflict(mismatch.conflict.id))}>
            {t('frules.mmDismiss')}
          </button>
        </div>
      )}

      {mode === 'exception' && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void act(async () => {
              await recordException(userId, {
                rule_id: upper.fact.id,
                ...(lowerLevel ? { folder_id: lowerLevel.id } : { project_id: projectId ?? (mismatch.lower.kind === 'project' ? mismatch.lower.fact.project_id : null) }),
                statement: what,
                authorised_by: who,
                how_confirmed: how,
                reason: why,
                from_note: mismatch.lower.kind === 'folder'
                  ? { kind: 'folder_fact', id: mismatch.lower.rule.fact.id, statement: mismatch.lower.rule.fact.statement }
                  : { kind: 'project_fact', id: mismatch.lower.fact.id, statement: mismatch.lower.fact.statement },
              });
              await retireLower('recorded as an exception');
            });
          }}
        >
          <p className="text-label text-[var(--on-surface-variant)]">{t('frules.exExplain', { place, level: levelName(upper.level) })}</p>
          <label className="text-label text-[var(--on-surface-variant)]">
            {t('frules.exWhat')}
            <textarea value={what} rows={2} onChange={(e) => setWhat(e.target.value.slice(0, 2_000))} className={field} />
          </label>
          <label className="text-label text-[var(--on-surface-variant)]">
            {t('frules.exWho')}
            <input value={who} onChange={(e) => setWho(e.target.value.slice(0, 200))} placeholder={t('frules.exWhoHint')} className={field} />
          </label>
          <label className="text-label text-[var(--on-surface-variant)]">
            {t('frules.exHow')}
            <input value={how} onChange={(e) => setHow(e.target.value.slice(0, 500))} placeholder={t('frules.exHowHint')} className={field} />
          </label>
          <label className="text-label text-[var(--on-surface-variant)]">
            {t('frules.exWhy')}
            <textarea value={why} rows={2} onChange={(e) => setWhy(e.target.value.slice(0, 1_000))} className={field} />
          </label>
          {!ready && <p className="text-label text-[var(--on-surface-variant)]">{t('frules.exNeedAll')}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !ready} className={primary}>{t('frules.exRecord')}</button>
            <button type="button" className={choice} onClick={() => setMode('choose')}>{t('frules.cancel')}</button>
          </div>
        </form>
      )}

      {mode === 'correct' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-label text-[var(--on-surface)]">{t('frules.mmCorrectWarn', { level: levelName(upper.level) })}</p>
          <textarea value={what} rows={2} aria-label={t('frules.changeLabel')} onChange={(e) => setWhat(e.target.value.slice(0, 2_000))} className={field} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !what.trim()} className={primary}
              onClick={() => void act(async () => {
                await supersedeFolderFact(upper.fact, what);
                await retireLower(`the rule of ${upper.level.name} was corrected`);
              })}>
              {t('frules.mmCorrectConfirm')}
            </button>
            <button type="button" className={choice} onClick={() => setMode('choose')}>{t('frules.cancel')}</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
    </div>
  );
}
