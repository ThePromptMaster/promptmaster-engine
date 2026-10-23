'use client';

/**
 * The accepted facts a user's change to a stage replaces, each with a tick to
 * update it (10 Oct, Sean: an applied revision and a restored version left the
 * facts saying Thursday, and Go changed the draft back to match them).
 */

import { useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import { recordFacts, supersedeFact } from '@/lib/supabase/facts';
import { describeFactChange, FACT_CHANGE_GROUPS, factChangeGroup, isNewFact, newFactNote, newFactSource, type FactChange } from '@/lib/workflow/fact-reconcile';
import type { Project } from '@/types/project';

export function FactChangeList({
  changes,
  kept,
  onToggle,
}: {
  changes: readonly FactChange[];
  /** The facts the user chose to leave as they are. */
  kept: ReadonlySet<string>;
  onToggle: (factId: string, update: boolean) => void;
}) {
  // Grouped by kind, so a changed value, a new fact and someone's request are
  // never read as the same thing (17 Oct, Sean, HARBOR).
  const t = useT();
  const groups = FACT_CHANGE_GROUPS.map((g) => ({ ...g, items: changes.filter((c) => factChangeGroup(c) === g.group) })).filter((g) => g.items.length);
  return (
    <>
      {groups.map((g) => (
        <div key={g.group} role="group" aria-label={t(`fcl.group.${g.group}`)} className="mt-2">
          <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t(`fcl.group.${g.group}`)}</p>
          <ul className="mt-1 space-y-2">
            {g.items.map((c) => (
              <li key={c.fact.id}>
                <label className="flex items-start gap-2 text-label text-[var(--on-surface)]">
                  <input type="checkbox" className="mt-0.5" checked={!kept.has(c.fact.id)} onChange={(e) => onToggle(c.fact.id, e.target.checked)} />
                  <span>
                    <span className="block">{c.proposed}</span>
                    <span className="block text-[var(--on-surface-variant)]">
                      {isNewFact(c)
                        ? newFactNote(c)
                        : <>{describeFactChange(c)} · {t('fcl.was')} &ldquo;{c.fact.statement}&rdquo;</>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {kept.size > 0 && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          {t('fcl.keptNote')}
        </p>
      )}
    </>
  );
}

export function toggled(prev: ReadonlySet<string>, factId: string, update: boolean): Set<string> {
  const next = new Set(prev);
  if (update) next.delete(factId);
  else next.add(factId);
  return next;
}

/**
 * After a version the user saved themselves — restored, or edited by hand —
 * states values the facts do not: the facts it changes, to update or keep.
 */
export function FactReconcileNotice({
  project,
  stageLabel,
  how,
  changes,
  onDone,
  onChanged,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  stageLabel: string;
  /** "The version you restored", "Your edit". */
  how: string;
  changes: readonly FactChange[];
  onDone: (outcome: 'updated' | 'kept') => void;
  onChanged?: () => Promise<unknown> | void;
}) {
  const t = useT();
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updating = changes.filter((c) => !kept.has(c.fact.id));
  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const c of updating) {
        if (isNewFact(c)) await recordFacts(project, [{ statement: c.proposed, kind: c.fact.kind, source_kind: 'user_edit', source_ref: newFactSource(c, { via: 'revision', stage: stageLabel, how }) }]);
        else await supersedeFact(project, c.fact, c.proposed, { via: 'revision', stage: stageLabel, how });
      }
      await onChanged?.();
      onDone('updated');
    } catch {
      setError(t('fcl.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={t('fcl.label')} className="mb-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3">
      <p className="text-body text-[var(--on-surface)]">
        {t('fcl.differs', { count: changes.length, how, stage: stageLabel })}
      </p>
      <FactChangeList changes={changes} kept={kept} onToggle={(id, on) => setKept((prev) => toggled(prev, id, on))} />
      {error && <p className="mt-2 text-label text-[var(--pm-error,var(--on-surface))]">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void update()}
          disabled={busy || updating.length === 0}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
        >
          {updating.length === 1 ? t('fcl.updateOne') : t('fcl.updateMany', { count: updating.length })}
        </button>
        <button
          onClick={() => onDone('kept')}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
        >
          {t('fcl.keep')}
        </button>
      </div>
    </section>
  );
}
