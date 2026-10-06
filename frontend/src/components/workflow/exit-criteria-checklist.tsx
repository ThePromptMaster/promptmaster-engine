'use client';

import { useState } from 'react';

import { approvalPending as isApprovalPending } from '@/lib/workflow/engine';
import type { CriterionResult } from '@/lib/workflow/types';

interface Props {
  criteria: CriterionResult[];
  /**
   * Authored-manual ids. Kept for callers that predate `CriterionResult.manual`;
   * the result's own flag wins, since it also covers degraded criteria.
   */
  manualIds?: Set<string>;
  onToggleManual: (id: string, checked: boolean) => void;
  /** Viewing a stage that cannot be worked on from here: boxes shown, not clickable. */
  readOnly?: boolean;
  /**
   * Fold to one summary line unless something needs the user (3 Oct call:
   * on check stages "it's all right there in front of you"). Open by default
   * whenever the stage has a box only the user can tick.
   */
  collapsible?: boolean;
  /**
   * Approvals Go committed under "Routine decisions: handle them for me", with
   * what its check found (5 Oct). The history says committed under the policy,
   * never approved by the user.
   */
  committedByPolicy?: Record<string, string>;
}

/**
 * What this stage still expects (FR-04).
 *
 * Shown continuously beside the work rather than revealed when the user tries
 * to leave — a checklist you only see at the exit is a gate, not guidance.
 *
 * Two groups (C1, Sean 28 Sep item 9): what PromptMaster checks for you as
 * you work, and what only you can decide. A criterion authored as a check
 * that cannot be computed here lands in the second group and says so, rather
 * than sitting as a circle nobody can fill. Each open row says whether it is
 * required — the stage stays open until the required ones are done — or
 * optional.
 */
export function ExitCriteriaChecklist({
  criteria,
  manualIds = new Set(),
  onToggleManual,
  readOnly = false,
  collapsible = false,
  committedByPolicy = {},
}: Props) {
  // A box only the user can tick is never folded away, ticked or not.
  const needsYou = criteria.some((c) => c.manual ?? manualIds.has(c.id));
  const [open, setOpen] = useState<boolean | null>(null);
  if (criteria.length === 0) return null;
  // Until the user toggles it, follow whether it needs them.
  const expanded = !collapsible || (open ?? needsYou);

  const withKind = criteria.map((c) => ({ c, manual: c.manual ?? manualIds.has(c.id) }));
  const checked = withKind.filter((r) => !r.manual);
  const yours = withKind.filter((r) => r.manual);
  const met = criteria.filter((c) => c.satisfied).length;
  const required = criteria.filter((c) => c.blocking).length;
  const optional = criteria.length - required;
  const requiredOpen = criteria.some((c) => c.blocking && !c.satisfied);
  // The work is done as far as PromptMaster can tell, and the only thing
  // open is the user's say-so. Said in words, because "complete" beside an
  // unticked required box read as a contradiction (1 Oct, item 7).
  const approvalPending = isApprovalPending(withKind.map((r) => ({ ...r.c, manual: r.manual })));

  const row = ({ c, manual }: { c: CriterionResult; manual: boolean }) => {
    const Row = manual ? 'label' : 'div';
    return (
      <li key={c.id}>
        <Row className={`flex items-start gap-2.5 text-body ${manual && !readOnly ? 'cursor-pointer' : ''}`}>
          {manual ? (
            <input
              type="checkbox"
              checked={c.satisfied}
              disabled={readOnly}
              onChange={(e) => onToggleManual(c.id, e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--pm-primary)]"
            />
          ) : (
            <span
              aria-hidden
              className={`material-symbols-outlined mt-px text-[18px] ${
                c.satisfied ? 'text-[var(--pm-secondary)]' : 'text-[var(--on-surface-variant)] opacity-60'
              }`}
            >
              {c.satisfied ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          )}

          <span className={c.satisfied ? 'text-[var(--on-surface-variant)]' : 'text-[var(--on-surface)]'}>
            {c.label}
            {/* Say what is actually missing — "3 of 5" beats a red cross. */}
            {!c.satisfied && c.detail && (
              <span className="ml-2 text-label text-[var(--on-surface-variant)]">{c.detail}</span>
            )}
            {!c.satisfied && (
              <span
                className={`ml-2 text-label uppercase tracking-wide ${
                  c.blocking ? 'text-[var(--pm-tertiary)]' : 'text-[var(--on-surface-variant)]'
                }`}
              >
                {c.blocking ? 'required' : 'optional'}
              </span>
            )}
            {c.degraded && !c.satisfied && (
              <span className="mt-0.5 block text-label leading-snug text-[var(--on-surface-variant)]">
                PromptMaster can&apos;t check this one here — it&apos;s yours to confirm.
              </span>
            )}
            {manual && c.authority === 'delegable' && !c.satisfied && (
              <span className="ml-2 text-label uppercase tracking-wide text-[var(--on-surface-variant)]">routine</span>
            )}
            {c.satisfied && committedByPolicy[c.id] !== undefined && (
              <span className="mt-0.5 block text-label leading-snug text-[var(--on-surface-variant)]">
                Committed under your routine-decision policy, after checking: {committedByPolicy[c.id]}
              </span>
            )}
            {!c.satisfied && c.hint && (
              <span className="mt-0.5 block text-label leading-snug text-[var(--on-surface-variant)]">{c.hint}</span>
            )}
          </span>
        </Row>
      </li>
    );
  };

  const group = (title: string, caption: string, rows: typeof withKind, label: string) => (
    <section aria-label={label}>
      <h4 className="flex flex-wrap items-baseline gap-x-2 text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
        {title}
        <span aria-hidden>·</span>
        <span className="normal-case tracking-normal">{caption}</span>
      </h4>
      <ul className="mt-2 space-y-2">{rows.map(row)}</ul>
    </section>
  );

  return (
    <section className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <header className="mb-1 flex items-baseline justify-between">
        <h3 className="text-title text-[var(--on-surface)]">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(!expanded)}
              className="inline-flex items-center gap-1"
            >
              <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
              To finish this stage
            </button>
          ) : (
            'To finish this stage'
          )}
        </h3>
        <span className="text-label text-[var(--on-surface-variant)]">
          {met} of {criteria.length} done
          {requiredOpen && !expanded && ' · required items open'}
          {readOnly && ' · viewing only'}
        </span>
      </header>
      <div hidden={!expanded}>
      <p className="mb-3 text-label text-[var(--on-surface-variant)]">
        {required} required{optional > 0 ? `, ${optional} optional` : ''}
        {approvalPending
          ? '. PromptMaster has verified what it can; this stage is waiting for your approval. You can still move on, but it stays open until you give it.'
          : requiredOpen
          ? '. You can still move on, but the stage stays open until the required items are done.'
          : optional > 0 && met < criteria.length
            ? '. The required items are done; the rest are yours to take or leave.'
            : '.'}
      </p>

      <div className="space-y-4">
        {checked.length > 0 && group('PromptMaster verified', 'checked for you as you work', checked, 'Checked by PromptMaster')}
        {yours.length > 0 &&
          group(
            'You approve',
            yours.some((r) => r.c.authority === 'delegable')
              ? 'yours to give; a routine one PromptMaster can check and commit for you, if you let it handle routine decisions'
              : 'only you can give these',
            yours,
            'For you to decide'
          )}
      </div>
      </div>
    </section>
  );
}
