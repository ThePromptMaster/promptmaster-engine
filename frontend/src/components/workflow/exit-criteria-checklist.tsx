'use client';

import type { CriterionResult } from '@/lib/workflow/types';

interface Props {
  criteria: CriterionResult[];
  /** Manual criteria are user-ticked; auto ones are computed and read-only. */
  manualIds: Set<string>;
  onToggleManual: (id: string, checked: boolean) => void;
}

/**
 * What this stage still expects (FR-04).
 *
 * Shown continuously beside the work rather than revealed when the user tries
 * to leave — a checklist you only see at the exit is a gate, not guidance.
 */
export function ExitCriteriaChecklist({ criteria, manualIds, onToggleManual }: Props) {
  if (criteria.length === 0) return null;

  const met = criteria.filter((c) => c.satisfied).length;

  return (
    <section className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-[var(--on-surface)]">Before moving on</h3>
        <span className="text-xs text-[var(--on-surface-variant)]">
          {met} of {criteria.length}
        </span>
      </header>

      <ul className="space-y-2">
        {criteria.map((c) => {
          const isManual = manualIds.has(c.id);
          const Row = isManual ? 'label' : 'div';

          return (
            <li key={c.id}>
              <Row
                className={`flex items-start gap-2.5 text-sm ${
                  isManual ? 'cursor-pointer' : ''
                }`}
              >
                {isManual ? (
                  <input
                    type="checkbox"
                    checked={c.satisfied}
                    onChange={(e) => onToggleManual(c.id, e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--pm-primary)]"
                  />
                ) : (
                  <span
                    aria-hidden
                    className={`material-symbols-outlined mt-px text-[18px] ${
                      c.satisfied
                        ? 'text-[var(--pm-secondary)]'
                        : 'text-[var(--on-surface-variant)] opacity-60'
                    }`}
                  >
                    {c.satisfied ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                )}

                <span
                  className={
                    c.satisfied
                      ? 'text-[var(--on-surface-variant)]'
                      : 'text-[var(--on-surface)]'
                  }
                >
                  {c.label}
                  {/* Say what is actually missing — "3 of 5" beats a red cross. */}
                  {!c.satisfied && c.detail && (
                    <span className="ml-2 text-xs text-[var(--on-surface-variant)]">
                      {c.detail}
                    </span>
                  )}
                  {!c.satisfied && c.blocking && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--pm-tertiary)]">
                      needed
                    </span>
                  )}
                </span>
              </Row>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
