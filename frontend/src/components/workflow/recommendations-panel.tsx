'use client';

/**
 * What to do next, and why — FR-13, FR-14, FR-15.
 *
 * Sits between the exit-criteria checklist and the evaluation panel, and that
 * order is the argument: the checklist states the gap, this proposes closing
 * it, and the evaluation below is the evidence some of these rest on.
 *
 * ## Two sources, one list
 *
 * **Derived** rows come from `deriveWorkflowRecommendations` — pure, free, and
 * guaranteed to produce at least one on every active stage. **Evaluation-driven**
 * rows are the corrections a model actually offered, and they are rows in the
 * database because they cost a call. The panel does not distinguish them
 * visually beyond a quiet label: a user does not care which code path produced
 * good advice.
 *
 * ## Per-row action reuses the triage vocabulary
 *
 * `ReviewStatusOption` + `CustomSelect` + a conditional `ReasonField`, exactly
 * as the review renderer does, honouring the same rule verbatim: **statuses
 * that dismiss demand a sentence and statuses that accept do not.** Dismissing
 * a recommendation without saying why leaves the same hole in six months that
 * an untriaged claim does — the decision trail records that something was
 * refused and nothing about what was weighed. The sentence lands in
 * `decisions.rationale`.
 *
 * A third idiom for "choose an outcome for this row" would have been the easy
 * thing to write and the wrong thing to have.
 *
 * ## Which statuses a row offers depends on what it can honestly do
 *
 * `workflow` and `setup` rows offer no Accept, because there is nothing here
 * to accept: their affordance is the checklist and `ProjectSetup`, and a
 * button that only records agreement while the gap stays open would be a dead
 * control. They vanish on their own the moment the criterion satisfies, which
 * is what "accepted" would have meant.
 */

import { useState } from 'react';

import { CustomSelect } from '@/components/shared/custom-select';
import { ReasonField } from '@/components/shared/reason-field';
import {
  SEVERITY_LABEL,
  describeScope,
  isApplyable,
  type ProposedRecommendation,
  type RecommendationSeverity,
} from '@/lib/workflow/recommend';
import type { ReviewStatusOption } from '@/lib/workflow/stage-artifact';

export type TriageStatus = 'accepted' | 'deferred' | 'dismissed';

export interface PanelRecommendation extends ProposedRecommendation {
  /** The row id, when this one has been persisted. Derived rows have none yet. */
  id?: string;
  /** 'evaluation' rows cost a model call and are already in the database. */
  origin: 'derived' | 'evaluation';
}

/**
 * The triage enum, in the shape the review renderer's control already takes.
 *
 * `deferred` requires a reason for the same reason the review table's does:
 * "carry this forward" without a note is indistinguishable from forgetting.
 * The note becomes the task's detail rather than being thrown away.
 */
const ACCEPT: ReviewStatusOption = { value: 'accepted', label: 'Accept', tone: 'done' };
const DEFER: ReviewStatusOption = {
  value: 'deferred',
  label: 'Not now',
  tone: 'neutral',
  requiresReason: true,
};
const DISMISS: ReviewStatusOption = {
  value: 'dismissed',
  label: 'Dismiss',
  tone: 'warn',
  requiresReason: true,
};

export function triageFor(rec: PanelRecommendation): ReviewStatusOption[] {
  if (rec.kind === 'workflow' || rec.kind === 'setup') return [DEFER, DISMISS];
  return [ACCEPT, DEFER, DISMISS];
}

/** Where the user actually closes this gap, when it is not closed from here. */
function affordanceHint(rec: PanelRecommendation): string | null {
  if (rec.kind === 'setup') return 'Fill it in under Project setup, above.';
  if (rec.kind === 'workflow') return 'The checklist above tracks it; this clears itself when it does.';
  return null;
}

const SEVERITY_CLASS: Record<RecommendationSeverity, string> = {
  blocking: 'text-[var(--pm-error)]',
  major: 'text-[var(--pm-tertiary)]',
  minor: 'text-[var(--on-surface-variant)]',
  info: 'text-[var(--on-surface-variant)]',
};

interface Props {
  stageLabel: string;
  rows: PanelRecommendation[];
  /** Category keys ticked for combining (FR-15). */
  selected: string[];
  onToggleSelect: (category: string, checked: boolean) => void;
  onTriage: (rec: PanelRecommendation, status: TriageStatus, reason: string) => void;
  /** Opens the apply preview. Never applies anything itself — FR-09. */
  onApply: (categories: string[]) => void;
  busy?: boolean;
  readOnly?: boolean;
}

export function RecommendationsPanel({
  stageLabel,
  rows,
  selected,
  onToggleSelect,
  onTriage,
  onApply,
  busy = false,
  readOnly = false,
}: Props) {
  if (rows.length === 0) return null;

  const applyable = rows.filter(isApplyable);
  const selectedApplyable = applyable.filter((r) => selected.includes(r.category));

  return (
    <section
      aria-label="Recommendations"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--on-surface)]">What to do next</h3>
        <span className="text-xs text-[var(--on-surface-variant)]">
          {rows.length} for {stageLabel}
        </span>
      </header>

      <ul className="space-y-2.5">
        {rows.map((rec) => (
          <RecommendationRow
            key={rec.category}
            rec={rec}
            selected={selected.includes(rec.category)}
            multiple={applyable.length > 1}
            onToggleSelect={onToggleSelect}
            onTriage={onTriage}
            onApply={onApply}
            busy={busy}
            readOnly={readOnly}
          />
        ))}
      </ul>

      {/* FR-15: combining is offered only when there is something to combine. */}
      {!readOnly && selectedApplyable.length > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-container-high)] px-4 py-3">
          <span className="text-label text-[var(--on-surface-variant)]">
            {selectedApplyable.length} selected — they will be applied as one revision.
          </span>
          <button
            onClick={() => onApply(selectedApplyable.map((r) => r.category))}
            disabled={busy}
            className="shrink-0 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-medium text-[var(--on-primary)] disabled:opacity-40"
          >
            Combine {selectedApplyable.length}…
          </button>
        </div>
      )}
    </section>
  );
}

interface RowProps {
  rec: PanelRecommendation;
  selected: boolean;
  multiple: boolean;
  onToggleSelect: (category: string, checked: boolean) => void;
  onTriage: (rec: PanelRecommendation, status: TriageStatus, reason: string) => void;
  onApply: (categories: string[]) => void;
  busy: boolean;
  readOnly: boolean;
}

function RecommendationRow({
  rec,
  selected,
  multiple,
  onToggleSelect,
  onTriage,
  onApply,
  busy,
  readOnly,
}: RowProps) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);

  const statuses = triageFor(rec);
  const chosen = statuses.find((s) => s.value === status);
  const needsReason = Boolean(chosen?.requiresReason);
  const reasonMissing = needsReason && !reason.trim();
  const canApply = isApplyable(rec);
  const hint = affordanceHint(rec);

  function commit() {
    if (!chosen || reasonMissing) return;
    // Accepting an applyable recommendation IS applying it: an accepted fix
    // that changed nothing is not a fix that was accepted.
    if (chosen.value === 'accepted' && canApply) {
      onApply([rec.category]);
      setStatus('');
      return;
    }
    onTriage(rec, chosen.value as TriageStatus, reason.trim());
    setStatus('');
    setReason('');
  }

  return (
    <li className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
      <div className="flex items-start gap-3">
        {/* FR-15's multi-select. Only where combining is possible at all — a
            checkbox beside something uncombinable is a promise that breaks. */}
        {!readOnly && canApply && multiple && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect(rec.category, e.target.checked)}
            aria-label={`Include "${rec.title}" in a combined revision`}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--pm-primary)]"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={`text-[10px] uppercase tracking-wide ${SEVERITY_CLASS[rec.severity]}`}
            >
              {SEVERITY_LABEL[rec.severity]}
            </span>
            <p className="text-body text-[var(--on-surface)]">{rec.title}</p>
          </div>

          <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{rec.summary}</p>

          {/* --- FR-14: the rationale, all four slots, none of them empty --- */}
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-1.5 inline-flex items-center gap-1 text-label text-[var(--pm-primary)]"
          >
            {expanded ? 'Hide why' : 'Why this'}
            <span aria-hidden className="material-symbols-outlined text-[14px]">
              {expanded ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {expanded && (
            <dl
              data-testid={`rationale-${rec.category}`}
              className="mt-2 space-y-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-2.5"
            >
              <Slot label="What triggered it" value={rec.rationale.triggering_issue} />
              <Slot label="Stage" value={rec.rationale.relevant_stage} />
              <Slot label="What it should give you" value={rec.rationale.expected_benefit} />
              <Slot label="What it affects" value={rec.rationale.scope} />
            </dl>
          )}

          {hint && (
            <p className="mt-1.5 text-label text-[var(--on-surface-variant)]">{hint}</p>
          )}

          {canApply && (
            <p className="mt-1.5 text-label text-[var(--on-surface-variant)]">
              Affects: {describeScope(rec.scope)}
            </p>
          )}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            {canApply && (
              <button
                onClick={() => onApply([rec.category])}
                disabled={busy}
                className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
              >
                Apply…
              </button>
            )}
            <CustomSelect
              value={status}
              options={statuses.map((s) => ({ value: s.value, label: s.label }))}
              placeholder="Decide"
              disabled={busy}
              ariaLabel={`What to do about "${rec.title}"`}
              onChange={(value) => {
                setStatus(value);
                setReason('');
                // Accepting an applyable one goes straight to the preview
                // rather than asking for a confirmation of a confirmation.
                const picked = statuses.find((s) => s.value === value);
                if (picked && !picked.requiresReason) {
                  if (value === 'accepted' && canApply) {
                    onApply([rec.category]);
                    setStatus('');
                  } else {
                    onTriage(rec, value as TriageStatus, '');
                    setStatus('');
                  }
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Statuses that set something aside demand a sentence. Shared with the
          review renderer, which established the rule. */}
      {!readOnly && needsReason && (
        <div className="mt-3">
          <ReasonField
            id={`rec-${rec.category}-reason`}
            label={
              chosen?.value === 'deferred'
                ? 'What still needs doing?'
                : `Why ${chosen?.label.toLowerCase()}?`
            }
            value={reason}
            missing={reasonMissing}
            missingMessage={
              chosen?.value === 'deferred'
                ? 'The task carries this sentence forward — without it, it is just a reminder that something was here.'
                : 'A dismissal without a reason is a shrug. Six months from now it will not be possible to tell it from an oversight.'
            }
            onChange={setReason}
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={commit}
              disabled={reasonMissing || busy}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
            >
              {chosen?.value === 'deferred' ? 'Add to tasks' : 'Dismiss'}
            </button>
            <button
              onClick={() => {
                setStatus('');
                setReason('');
              }}
              className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Slot({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-label text-[var(--on-surface)]">{value}</dd>
    </div>
  );
}
