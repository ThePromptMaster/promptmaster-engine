'use client';

import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import type { OpenMismatch } from '@/lib/folders/inheritance';
import { MismatchChoice } from './mismatch-choice';

/**
 * On a stage that waits on a mismatch the user has not chosen (Sean, 23 Nov:
 * "pause the reference work that depends on the answer and let the rest of the
 * search continue"; L-280): what it turns on, the choice itself, and a way to
 * say this stage does not depend on it after all.
 */
export function HeldStageNotice({
  held,
  stageLabel,
  userId,
  projectId,
  onChanged,
  onRelease,
}: {
  held: { mismatch: OpenMismatch; quote: string };
  stageLabel: string;
  userId: string;
  projectId: string;
  onChanged: () => void | Promise<void>;
  onRelease: () => Promise<unknown>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={t('frules.heldTitle')} className="mb-6 rounded-xl bg-[color-mix(in_srgb,var(--pm-error)_8%,var(--surface-container-low))] px-5 py-4">
      <p className="flex items-center gap-1.5 text-title text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[18px]">pause_circle</span>
        {t('frules.heldTitle')}
      </p>
      <p className="mt-1 text-body text-[var(--on-surface-variant)]">{t('frules.heldWhy', { stage: stageLabel, quote: held.quote })}</p>
      <div className="mt-3">
        <MismatchChoice mismatch={held.mismatch} userId={userId} projectId={projectId} onDone={onChanged} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void (async () => {
          setBusy(true);
          try {
            await onRelease();
          } finally {
            setBusy(false);
          }
        })()}
        className="mt-3 rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
      >
        {t('frules.release')}
      </button>
    </section>
  );
}
