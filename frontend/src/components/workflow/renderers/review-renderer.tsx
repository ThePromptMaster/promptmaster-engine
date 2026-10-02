'use client';

/**
 * Review stages: fact-checking, continuity findings, critique triage.
 *
 * A real table — nothing tabular existed in this app before. The row structure
 * is adapted from audit-findings-panel.tsx, the status control from
 * shared/custom-select.tsx, and the conditionally-required reason flow from
 * stage-transition-bar.tsx, which already established the rule this stage
 * depends on: **a decision to set something aside has to carry a reason.**
 *
 * "Rejected" on its own is a shrug. Six months later nobody can tell a claim
 * that was checked and dropped from one that was never looked at, which is
 * exactly the distinction a fact-check stage exists to preserve. So statuses
 * that dismiss demand a sentence and statuses that accept do not — and a row
 * missing that sentence is not counted as triaged, which is what keeps the
 * stage's exit criterion honest rather than decorative.
 *
 * Like the list renderer, entirely schema-driven: the columns are whatever the
 * item schema declares and the statuses are whatever it offers.
 */

import { useEffect, useMemo, useState, useRef } from 'react';

import { CustomSelect } from '@/components/shared/custom-select';
import { ReasonField } from '@/components/shared/reason-field';
import { reasonFromRow } from '@/lib/workflow/run-result';
import {
  isTriaged,
  parseItems,
  statusOption,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';

const TONE_CLASS: Record<string, string> = {
  done: 'text-[var(--pm-secondary)]',
  warn: 'text-[var(--pm-tertiary)]',
  neutral: 'text-[var(--on-surface-variant)]',
};

export function ReviewRenderer({
  stage,
  hideStageActions = false,
  onDirtyChange,
  schema,
  versions,
  evaluation,
  activeVersionId,
  onSelectVersion,
  onRestore,
  onSaveItems,
  onLookupItems,
  generating,
  generationError,
  generationFailure,
  evaluationFailure,
  onDismissFailure,
  onSwitchModel,
  currentModel,
  onGenerate,
  onCancelGeneration,
  onEvaluate,
  evaluating,
  evaluationError,
  readOnly,
}: StageRendererProps) {
  const active = useMemo(
    () => versions.find((v) => v.id === activeVersionId) ?? versions.at(-1) ?? null,
    [versions, activeVersionId]
  );

  const saved = useMemo(() => parseItems(active?.content) ?? [], [active]);
  const [rows, setRows] = useState<StageItem[]>(saved);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  // The named sources, searched for in a public index. What comes back is
  // unsaved: the user reads what was found, then saves.
  async function lookUp() {
    if (!onLookupItems || lookingUp) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const result = await onLookupItems(rows);
      setRows(result.items);
      setLookupNote(result.message);
    } catch (e) {
      setLookupNote(e instanceof Error && e.message ? `The lookup did not work: ${e.message}` : 'The lookup did not work. Nothing was changed.');
    } finally {
      setLookingUp(false);
    }
  }

  const activeId = active?.id ?? null;
  useEffect(() => {
    setRows(parseItems(active?.content) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved]);
  const statuses = schema.statuses ?? [];
  const triaged = rows.filter((r) => isTriaged(r, schema)).length;
  const outstanding = rows.length - triaged;

  // PM-06: tell the workspace about unsaved edits, so "Save changes" can lead.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    onDirtyChange?.({ dirty, save: () => saveRef.current() });
  }, [dirty, onDirtyChange]);

  function patch(id: string, key: string, value: string) {
    // A status or reason the user touches is theirs from then on.
    const mine = key === 'status' || key === 'reason' ? { status_source: 'user' } : {};
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next: StageItem = { ...r, [key]: value, ...mine };
      // The row often already says why ("no source data were provided"):
      // offer that as the reason rather than have it typed a second time.
      if (key === 'status' && statuses.find((s) => s.value === value)?.requiresReason && !(r.reason ?? '').trim()) {
        const known = reasonFromRow(r, schema);
        if (known) Object.assign(next, { reason: known, reason_source: 'row' });
      }
      if (key === 'reason') delete next.reason_source;
      return next;
    }));
  }
  // Rows whose status the draft itself set, because it already knew the
  // outcome (1 Oct, items 3 and 18). They count as resolved; the user can
  // still change any of them.
  const setByModel = rows.filter((r) => r.status_source === 'model' && isTriaged(r, schema)).length;
  // …and rows a sandbox run settled: the code ran, and what it printed is on the row.
  const blockedStatus = schema.execution?.blocked;
  const setByRun = rows.filter((r) => r.status_source === 'sandbox' && r.status !== blockedStatus && isTriaged(r, schema)).length;
  // …and rows whose run could not be made: the run's own reason is on the row.
  const blockedRuns = rows.filter((r) => r.status_source === 'sandbox' && r.status === blockedStatus && isTriaged(r, schema)).length;

  async function save() {
    if (!onSaveItems || saving) return;
    setSaving(true);
    try {
      await onSaveItems(rows);
    } finally {
      setSaving(false);
    }
  }

  function requestGenerate() {
    if (rows.length > 0) setConfirming(true);
    else onGenerate();
  }

  // A field only a lookup or the user fills is a column once some row holds it.
  const columns = schema.fields.filter((f) => !f.userOnly || rows.some((r) => (r[f.key] ?? '').trim()));

  return (
    <section aria-label={`${stage.label} work`}>
      {confirming && (
        <ConfirmOverwrite
          label={`${schema.itemLabel}s`}
          onConfirm={() => {
            setConfirming(false);
            onGenerate({ force: true });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      <GenerationBar
        compact={hideStageActions}
        label={`${schema.itemLabel}s`}
        generating={generating}
        error={generationError}
        hasContent={rows.length > 0}
        onGenerate={requestGenerate}
        onCancel={onCancelGeneration}
        onEvaluate={onEvaluate}
        evaluating={evaluating}
        evaluationError={evaluationError}
        failure={generationFailure}
        evaluationFailure={evaluationFailure}
        onDismissFailure={onDismissFailure}
        onSwitchModel={onSwitchModel}
        currentModel={currentModel}
        readOnly={readOnly}
      />

      <VersionBar
          evaluation={evaluation}
        versions={versions}
        activeVersionId={activeVersionId}
        headVersionId={versions.at(-1)?.id ?? null}
        onSelect={onSelectVersion}
        onRestore={onRestore}
        readOnly={readOnly}
      />

      {rows.length === 0 && !generating ? (
        <EmptyStage label={`${schema.itemLabel}s`} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <h3 className="text-title text-[var(--on-surface)]">
              {rows.length} {rows.length === 1 ? schema.itemLabel : `${schema.itemLabel}s`}
            </h3>
            <span
              className={`text-label ${
                outstanding === 0 ? 'text-[var(--pm-secondary)]' : 'text-[var(--on-surface-variant)]'
              }`}
            >
              {outstanding === 0 ? 'all resolved' : `${outstanding} still to resolve`}
            </span>
            {setByModel > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                · {setByModel} set by PromptMaster from what it already knew — review or change
              </span>
            )}
            {setByRun > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                · {setByRun} recorded from code that ran in the sandbox
              </span>
            )}
            {blockedRuns > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                · {blockedRuns} could not be run — PromptMaster recorded why; review or change
              </span>
            )}
          </div>

          {schema.lookup && onLookupItems && !readOnly && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void lookUp()}
                disabled={lookingUp}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
              >
                <span aria-hidden className={`material-symbols-outlined text-[16px] ${lookingUp ? 'animate-spin' : ''}`}>
                  {lookingUp ? 'progress_activity' : 'travel_explore'}
                </span>
                {lookingUp ? 'Looking them up…' : `Look up these ${schema.lookup.noun}`}
              </button>
              <span className="text-label text-[var(--on-surface-variant)]">
                Searches OpenAlex for each named source. It finds whether the source exists, not whether it says this.
                Nothing is saved until you save.
              </span>
            </div>
          )}
          {lookupNote && (
            <p role="status" className="mb-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface)]">
              {lookupNote}
            </p>
          )}

          {schema.decisionQuestion && !readOnly && (
            <p data-decision-question className="mb-3 max-w-[70ch] text-body text-[var(--on-surface)]">
              {schema.decisionQuestion}
            </p>
          )}

          {/* The table scrolls inside its own container: at five columns it is
              wider than the 820px content well on a laptop, and a horizontally
              scrolling page is worse than a horizontally scrolling table. */}
          <div data-stage-table tabIndex={-1} className="scroll-mt-24 overflow-x-auto rounded-xl bg-[var(--surface-container-lowest)] outline-none">
            <table className="w-full min-w-[720px] border-collapse">
              <caption className="sr-only">
                {stage.label}: one row per {schema.itemLabel}, each with a status and, where the
                status requires it, a reason.
              </caption>
              <thead>
                <tr className="bg-[var(--surface-container-low)]">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="px-4 py-3 text-left text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="w-[200px] px-4 py-3 text-left text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    columns={columns}
                    statuses={statuses}
                    schema={schema}
                    readOnly={readOnly}
                    onPatch={patch}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {statuses.some((s) => s.explain) && (
            <dl aria-label="What the statuses mean" className="mt-3 grid gap-x-4 gap-y-1 text-label sm:grid-cols-[max-content_1fr]">
              {statuses.filter((s) => s.explain && (!s.legacy || rows.some((r) => r.status === s.value))).map((s) => (
                <div key={s.value} className="contents">
                  <dt className={TONE_CLASS[s.tone]}>{s.label}</dt>
                  <dd className="text-[var(--on-surface-variant)]">{s.explain}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {!readOnly && onSaveItems && rows.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
        </div>
      )}
    </section>
  );
}

interface ReviewRowProps {
  row: StageItem;
  columns: StageRendererProps['schema']['fields'];
  statuses: NonNullable<StageRendererProps['schema']['statuses']>;
  schema: StageRendererProps['schema'];
  readOnly: boolean;
  onPatch: (id: string, key: string, value: string) => void;
}

function ReviewRow({ row, columns, statuses, schema, readOnly, onPatch }: ReviewRowProps) {
  const option = statusOption(schema, row.status);
  const needsReason = Boolean(option?.requiresReason);
  const reasonMissing = needsReason && !(row.reason ?? '').trim();

  return (
    <>
      <tr className="align-top" {...(isTriaged(row, schema) ? {} : { 'data-undecided': '' })}>
        {columns.map((c) => (
          <td
            key={c.key}
            className="px-4 py-3 text-body leading-relaxed text-[var(--on-surface)]"
          >
            {row[c.key] || <span className="text-[var(--on-surface-variant)]">—</span>}
          </td>
        ))}
        <td className="px-4 py-3">
          {readOnly ? (
            <span className={`text-body ${TONE_CLASS[option?.tone ?? 'neutral']}`}>
              {option?.label ?? 'Not looked at'}
            </span>
          ) : (
            <CustomSelect
              value={row.status ?? ''}
              options={statuses.filter((s) => (s.settable !== false && !s.legacy) || s.value === row.status).map((s) => ({ value: s.value, label: s.label }))}
              placeholder="Not looked at"
              onChange={(value) => onPatch(row.id, 'status', value)}
            />
          )}
          {row.status_source === 'model' && option && option.decided !== false && (
            <span className="mt-1 block text-label text-[var(--on-surface-variant)]">Set by PromptMaster</span>
          )}
          {row.status_source === 'sandbox' && option && (
            <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
              {row.status === schema.execution?.blocked ? 'Recorded by PromptMaster: the run could not be made' : 'Recorded from a sandbox run'}
            </span>
          )}
        </td>
      </tr>

      {/* The reason lives in its own row rather than a cramped cell: it is a
          sentence, and squeezing it beside a select made both unreadable.

          `ReasonField` is shared with the recommendations panel, which needs
          the identical control for the identical reason — dismissing a
          recommendation is dismissing a finding. It was extracted from here. */}
      {needsReason && (
        <tr>
          <td colSpan={columns.length + 1} className="px-4 pb-4">
            <ReasonField
              id={`${row.id}-reason`}
              label={`Why ${option?.label.toLowerCase()}?`}
              value={row.reason ?? ''}
              disabled={readOnly}
              missing={reasonMissing}
              missingMessage="This one still counts as unresolved until you say why."
              onChange={(value) => onPatch(row.id, 'reason', value)}
            />
            {row.reason_source === 'row' && !reasonMissing && (
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                Filled in from what this row already says — edit it if that is not the reason.
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
