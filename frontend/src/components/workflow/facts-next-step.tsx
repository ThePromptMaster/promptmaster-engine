'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { NEXT_STEP_LABELS } from '@/lib/workflow/stage-controls';

/**
 * Under "8 facts recorded": what happens next, and the one button for it
 * (Sean, 14 Oct, SUMMIT: "Could 'Record these facts' change to 'Facts
 * recorded' after success … and clearly direct me to 'Update affected work and
 * resume'?"). The same button, in the same words, as the next-step bar at the
 * top of every stage, so the chat and the page never disagree (17 Oct).
 */
export function FactsNextStep({
  judging,
  offered,
  waiting,
  onUpdate,
  updating,
  updated,
}: {
  /** The change check is still working out what the facts affect. */
  judging: boolean;
  /** What these facts may affect, offered: nothing has changed until the user says so (5 Nov). */
  offered?: { names: readonly string[]; onUpdate: () => void; onKeep: () => void };
  /** The stages awaiting an update, by label. */
  waiting: readonly string[];
  onUpdate?: () => void;
  updating: boolean;
  /** The stages the last change reopened, once each is finished again. */
  updated?: readonly string[];
}) {
  const t = useT();
  const text = 'text-label text-[var(--on-surface-variant)]';
  if (offered?.names.length) {
    return (
      <div data-offered-change>
        <p className={text}>{t('fns.mayAffect', { names: offered.names.join(', ') })}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button onClick={offered.onUpdate} disabled={updating} className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50">
            {updating ? t('fns.updating') : t('fns.updateWith', { names: offered.names.join(', ') })}
          </button>
          <button onClick={offered.onKeep} disabled={updating} className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50">
            {t('fns.keepOnRecord')}
          </button>
        </div>
      </div>
    );
  }
  if (waiting.length) {
    return (
      <div>
        <p className={text}>
          {t('fns.relied', { count: waiting.length, names: waiting.join(', ') })}
        </p>
        {onUpdate && (
          <button
            onClick={onUpdate}
            disabled={updating}
            className="mt-1.5 rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
          >
            {updating ? t('fns.updating') : NEXT_STEP_LABELS.applyContinue}
          </button>
        )}
      </div>
    );
  }
  if (judging) {
    return (
      <p role="status" className={text}>
        {t('fns.checking')}
      </p>
    );
  }
  if (updated?.length) {
    return (
      <p role="status" className={text}>
        <span aria-hidden className="material-symbols-outlined me-1 align-[-3px] text-[16px] text-[var(--pm-success)]">check_circle</span>
        {t('fns.updated', { names: updated.join(', ') })}
      </p>
    );
  }
  return <p className={text}>{t('fns.nothing')}</p>;
}

/**
 * The same offer at the top of the page, so it does not go with the chat (5 Nov,
 * a rollout pack: a report recorded from a review reopened the approved pack).
 */
export function OfferedChangeNotice({
  names,
  reasons,
  onUpdate,
  onKeep,
  updating,
}: {
  names: readonly string[];
  reasons: readonly string[];
  onUpdate: () => void;
  onKeep: () => void;
  updating: boolean;
}) {
  const t = useT();
  return (
    <section role="status" aria-label={t('fns.offerLabel')} data-offered-change className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p className="text-body text-[var(--on-surface)]">{t('fns.mayAffect', { names: names.join(', ') })}</p>
      {reasons.filter(Boolean).length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-label text-[var(--on-surface-variant)]">
          {reasons.filter(Boolean).map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onUpdate} disabled={updating} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50">
          {updating ? t('fns.updating') : t('fns.updateWith', { names: names.join(', ') })}
        </button>
        <button onClick={onKeep} disabled={updating} className="rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-title text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50">
          {t('fns.keepOnRecord')}
        </button>
      </div>
    </section>
  );
}
