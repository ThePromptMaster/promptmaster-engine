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

import { isSuperseded } from '@/lib/workflow/superseded-rows';
import { findingRisk, isTriageTable } from '@/lib/workflow/triage';
import { useEffect, useMemo, useState, useRef } from 'react';

import { CustomSelect } from '@/components/shared/custom-select';
import { ReasonField } from '@/components/shared/reason-field';
import { reasonFromRow } from '@/lib/workflow/run-result';
import {
  awaitsAttempt,
  confirmableProposals,
  confirmProposals,
  isProposed,
  isTriaged,
  parseItems,
  statusOption,
  statusContradictsRow,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';

/** A table longer than this folds the rows already decided. */
const FOLD_AFTER = 6;
import { confirmProposalsLabel, lookupLabel } from '@/lib/workflow/stage-controls';
import { proposeTargets } from '@/lib/workflow/proposals';
import { rowsRequired } from '@/lib/workflow/engine';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { stageText } from '@/lib/i18n/templates';

const TONE_CLASS: Record<string, string> = {
  done: 'text-[var(--pm-secondary)]',
  warn: 'text-[var(--pm-tertiary)]',
  neutral: 'text-[var(--on-surface-variant)]',
};

export function ReviewRenderer({
  stage,
  templateKey,
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
  onProposeStatuses,
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
  canConfirmWhenReadOnly,
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
  const [showSettled, setShowSettled] = useState(false);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const t = useT();
  const locale = useLocale();
  const shownLabel = stageText(locale, templateKey, stage, 'label');

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
      setLookupNote(e instanceof Error && e.message ? t('stage.lookupFailedWhy', { why: e.message }) : t('stage.lookupFailed'));
    } finally {
      setLookingUp(false);
    }
  }

  // Rows the draft left without a status: PromptMaster reads each and
  // proposes one from its own text (3 Oct). Unsaved until confirmed or saved.
  const [proposing, setProposing] = useState(false);
  async function propose() {
    if (!onProposeStatuses || proposing) return;
    setProposing(true);
    setLookupNote(null);
    try {
      const result = await onProposeStatuses(rows);
      setRows(result.items);
      setLookupNote(result.message);
    } catch (e) {
      setLookupNote(e instanceof Error && e.message ? t('stage.noProposalsWhy', { why: e.message }) : t('stage.noProposals'));
    } finally {
      setProposing(false);
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
  // "It's all right there in front of you" (3 Oct call): rows already settled
  // in the saved version fold away once the table is long. Taken from the
  // saved version, not the live edits, so a row never jumps out from under the
  // pointer while it is being decided.
  // Only while something is still open: a table that is all decided (a
  // sandbox run settled every row, production Research pass) folded to a lone
  // "8 already decided — show" and hid the whole result.
  const settledIds = useMemo(() => {
    const settled = saved.filter((r) => isTriaged(r, schema));
    return new Set(saved.length > FOLD_AFTER && settled.length < saved.length ? settled.map((r) => r.id) : []);
  }, [saved, schema]);
  // Findings on a value a later fact replaced (17 Oct, Sean, 20→12): kept, folded apart.
  const supersededRows = rows.filter(isSuperseded);
  const openRows = rows.filter((r) => !settledIds.has(r.id) && !isSuperseded(r));
  const foldedRows = rows.filter((r) => settledIds.has(r.id) && !isSuperseded(r));
  const outstanding = rows.length - triaged;
  // Whether the stage requires a status on every row. Final review's open
  // items do not: "10 still to resolve" beside "0 required" read as a
  // contradiction (3 Oct). Decided by the stage's own criteria.
  const statusRequired = rowsRequired(stage);

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

  /**
   * "Use this reason for the other rows marked the same" (13 Oct; Sean's
   * regression list, "repeated reasons"): one reason, many rows — by the
   * user's click, never filled in on rows they have not looked at.
   */
  function applyReasonToSame(fromId: string) {
    setRows((prev) => {
      const from = prev.find((r) => r.id === fromId);
      const reason = (from?.reason ?? '').trim();
      if (!from || !reason) return prev;
      return prev.map((r) =>
        r.id !== fromId && r.status === from.status && !(r.reason ?? '').trim()
          ? { ...r, reason, reason_source: 'same', status_source: 'user' }
          : r
      );
    });
  }
  const missingReasonFor = (status: string | undefined, exceptId: string) =>
    status ? rows.filter((r) => r.id !== exceptId && r.status === status && !(r.reason ?? '').trim()).length : 0;
  // Rows whose status the draft itself set, because it already knew the
  // outcome (1 Oct, items 3 and 18). They count as resolved; the user can
  // still change any of them.
  const setByModel = rows.filter((r) => r.status_source === 'model' && isTriaged(r, schema)).length;
  // …and rows a sandbox run settled: the code ran, and what it printed is on the row.
  const blockedStatus = schema.execution?.blocked;
  const setByRun = rows.filter((r) => r.status_source === 'sandbox' && r.status !== blockedStatus && isTriaged(r, schema)).length;
  // …and rows whose run could not be made: the run's own reason is on the row.
  const blockedRuns = rows.filter((r) => r.status_source === 'sandbox' && r.status === blockedStatus && isTriaged(r, schema)).length;

  // Rows whose status PromptMaster proposed from what the row already says
  // (3 Oct). They count only once the user confirms them — one click for all
  // of them, or by changing any one.
  const proposed = rows.filter(isProposed).length;
  const deferred = rows.filter((r) => r.status === 'deferred' && !isProposed(r)).length;
  const confirmable = confirmableProposals(rows, schema).length;
  async function confirmAll() {
    if (!onSaveItems || saving) return;
    const next = confirmProposals(rows, schema);
    setRows(next);
    setSaving(true);
    try {
      await onSaveItems(next);
    } finally {
      setSaving(false);
    }
  }

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
    <section aria-label={t('stage.work', { stage: shownLabel })}>
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
              {outstanding === 0
                ? deferred > 0
                  // Deferred is decided, not resolved (Sean, 10 Oct, email 8:
                  // "'All resolved' includes deferred concerns").
                  ? t('stage.allDecidedDeferred', { count: deferred })
                  : t('stage.allDecided')
                : statusRequired
                  ? t('stage.stillToResolve', { count: outstanding })
                  : t('stage.notYetMarked', { count: outstanding })}
            </span>
            {proposed > 0 && (
              <span data-proposals className="text-label text-[var(--on-surface-variant)]">
                {t('stage.proposedCount', { count: proposed })}
              </span>
            )}
            {setByModel > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                {t('stage.setByModelCount', { count: setByModel })}
              </span>
            )}
            {setByRun > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                {t('stage.setByRunCount', { count: setByRun })}
              </span>
            )}
            {blockedRuns > 0 && (
              <span className="text-label text-[var(--on-surface-variant)]">
                {t('stage.blockedRunsCount', { count: blockedRuns })}
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
                {lookingUp ? t('stage.lookingUp') : lookupLabel(schema.lookup.noun)}
              </button>
              <span className="text-label text-[var(--on-surface-variant)]">
                {t('stage.lookupExplainReview')}
              </span>
            </div>
          )}
          {onProposeStatuses && !readOnly && proposeTargets(rows, schema).length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                data-propose-statuses
                onClick={() => void propose()}
                disabled={proposing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
              >
                <span aria-hidden className={`material-symbols-outlined text-[16px] ${proposing ? 'animate-spin' : ''}`}>
                  {proposing ? 'progress_activity' : 'auto_awesome'}
                </span>
                {proposing ? t('stage.readingRows') : t('stage.propose')}
              </button>
              <span className="text-label text-[var(--on-surface-variant)]">
                {t('stage.proposeExplain')}
              </span>
            </div>
          )}
          {lookupNote && (
            <p role="status" className="mb-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface)]">
              {lookupNote}
            </p>
          )}

          {confirmable > 0 && (!readOnly || (canConfirmWhenReadOnly && active?.id === versions.at(-1)?.id)) && onSaveItems && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                data-confirm-proposals
                onClick={() => void confirmAll()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">done_all</span>
                {confirmProposalsLabel(confirmable)}
              </button>
              <span className="max-w-[60ch] text-label text-[var(--on-surface-variant)]">
                {t('stage.confirmExplain')}
              </span>
            </div>
          )}

          {schema.decisionQuestion && !readOnly && (
            <p data-decision-question className="mb-3 max-w-[70ch] text-body text-[var(--on-surface)]">
              {schema.decisionQuestion}
            </p>
          )}
          {/* A check stage works differently from a writing stage, and said so
              nowhere ("where do I go?", 3 Oct call). */}
          {!readOnly && outstanding > 0 && (
            <p data-check-stage-note className="mb-3 max-w-[70ch] text-label text-[var(--on-surface-variant)]">
              {t('stage.checkStageNote')}
              {stage.transitions.default_next ? t('stage.checkStageLater') : t('stage.checkStageLast')}
            </p>
          )}

          {/* The table scrolls inside its own container: at five columns it is
              wider than the 820px content well on a laptop, and a horizontally
              scrolling page is worse than a horizontally scrolling table. */}
          {/* In a narrow pane each row is a card — the finding, then its status
              and reason under it — so nothing scrolls sideways on a phone or an
              iPad in portrait (Sean, 10 Oct, emails 6.11 and 8). Measured on the
              pane, not the screen: an iPad in landscape with the side chat open
              left the table about 470px and still forced it to 720 (17 Oct,
              NORTHSTAR-2). */}
          <div data-stage-table tabIndex={-1} className="@container scroll-mt-24 overflow-x-auto rounded-xl bg-[var(--surface-container-lowest)] outline-none">
            <table className="w-full border-collapse @max-2xl:block">
              <caption className="sr-only">
                {t('stage.caption', { stage: shownLabel, label: schema.itemLabel })}
              </caption>
              <thead>
                <tr className="bg-[var(--surface-container-low)] @max-2xl:hidden">
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
                    className="w-[180px] px-4 py-3 text-left text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
                  >
                    {t('stage.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="@max-2xl:block">
                {openRows.map((row) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    columns={columns}
                    statuses={statuses}
                    schema={schema}
                    readOnly={readOnly}
                    onPatch={patch}
                    sameMissing={missingReasonFor(row.status, row.id)}
                    onApplyReasonToSame={() => applyReasonToSame(row.id)}
                  />
                ))}
                {foldedRows.length > 0 && (
                  <tr className="@max-2xl:block">
                    <td colSpan={columns.length + 1} className="px-4 py-2 @max-2xl:block">
                      <button
                        type="button"
                        aria-expanded={showSettled}
                        onClick={() => setShowSettled((v) => !v)}
                        className="inline-flex items-center gap-1 text-label text-[var(--pm-primary)]"
                      >
                        <span aria-hidden className="material-symbols-outlined text-[18px]">
                          {showSettled ? 'expand_less' : 'expand_more'}
                        </span>
                        {showSettled
                          ? t('stage.hideDecided', { count: foldedRows.length })
                          : t('stage.showDecided', { count: foldedRows.length })}
                      </button>
                    </td>
                  </tr>
                )}
                {showSettled &&
                  foldedRows.map((row) => (
                    <ReviewRow
                      key={row.id}
                      row={row}
                      columns={columns}
                      statuses={statuses}
                      schema={schema}
                      readOnly={readOnly}
                      onPatch={patch}
                      sameMissing={missingReasonFor(row.status, row.id)}
                      onApplyReasonToSame={() => applyReasonToSame(row.id)}
                    />
                  ))}
                {supersededRows.length > 0 && (
                  <tr className="max-md:block">
                    <td colSpan={columns.length + 1} className="px-4 py-2 max-md:block">
                      <button
                        type="button"
                        aria-expanded={showSuperseded}
                        onClick={() => setShowSuperseded((v) => !v)}
                        className="inline-flex items-center gap-1 text-label text-[var(--pm-primary)]"
                      >
                        <span aria-hidden className="material-symbols-outlined text-[18px]">
                          {showSuperseded ? 'expand_less' : 'expand_more'}
                        </span>
                        {showSuperseded
                          ? t('stage.hideEarlier', { count: supersededRows.length })
                          : t('stage.showEarlier', { count: supersededRows.length })}
                      </button>
                    </td>
                  </tr>
                )}
                {showSuperseded &&
                  supersededRows.map((row) => (
                    <ReviewRow
                      key={row.id}
                      row={row}
                      columns={columns}
                      statuses={statuses}
                      schema={schema}
                      readOnly={readOnly}
                      onPatch={patch}
                      sameMissing={missingReasonFor(row.status, row.id)}
                      onApplyReasonToSame={() => applyReasonToSame(row.id)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
          {statuses.some((s) => s.explain) && (
            <details className="mt-3">
            <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">{t('stage.statusesMean')}</summary>
            <dl aria-label={t('stage.statusesMean')} className="mt-2 grid gap-x-4 gap-y-1 text-label sm:grid-cols-[max-content_1fr]">
              {statuses.filter((s) => s.explain && (!s.legacy || rows.some((r) => r.status === s.value))).map((s) => (
                <div key={s.value} className="contents">
                  <dt className={TONE_CLASS[s.tone]}>{s.label}</dt>
                  <dd className="text-[var(--on-surface-variant)]">{s.explain}</dd>
                </div>
              ))}
            </dl>
            </details>
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
            {saving ? t('stage.saving') : t('stage.saveVersion')}
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
  /** Other rows with this row's status and no reason yet. */
  sameMissing?: number;
  onApplyReasonToSame?: () => void;
}

function ReviewRow({ row, columns, statuses, schema, readOnly, onPatch, sameMissing = 0, onApplyReasonToSame }: ReviewRowProps) {
  const option = statusOption(schema, row.status);
  const needsReason = Boolean(option?.requiresReason);
  const reasonMissing = needsReason && !(row.reason ?? '').trim();
  const t = useT();

  return (
    <>
      <tr className="align-top @max-2xl:block @max-2xl:border-b @max-2xl:border-[var(--surface-container-high)] @max-2xl:py-2" {...(isTriaged(row, schema) ? {} : { 'data-undecided': '' })}>
        {columns.map((c) => (
          <td
            key={c.key}
            data-label={c.label}
            className="px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] @max-2xl:block @max-2xl:py-1 @max-2xl:before:block @max-2xl:before:text-label @max-2xl:before:uppercase @max-2xl:before:tracking-wider @max-2xl:before:text-[var(--on-surface-variant)] @max-2xl:before:content-[attr(data-label)]"
          >
            {row[c.key] || <span className="text-[var(--on-surface-variant)]">—</span>}
            {c === columns[0] && isSuperseded(row) && (
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t('stage.supersededBy', { by: row.superseded_by ?? '' })}</span>
            )}
          </td>
        ))}
        <td data-label={t('stage.status')} className="px-4 py-3 @max-2xl:block @max-2xl:py-1 @max-2xl:before:block @max-2xl:before:text-label @max-2xl:before:uppercase @max-2xl:before:tracking-wider @max-2xl:before:text-[var(--on-surface-variant)] @max-2xl:before:content-[attr(data-label)]">
          {readOnly ? (
            <span className={`text-body ${TONE_CLASS[option?.tone ?? 'neutral']}`}>
              {option?.label ?? t('stage.notLookedAt')}
            </span>
          ) : (
            <CustomSelect
              value={row.status ?? ''}
              options={statuses.filter((s) => (s.settable !== false && !s.legacy) || s.value === row.status).map((s) => ({ value: s.value, label: s.label }))}
              placeholder={t('stage.notLookedAt')}
              onChange={(value) => onPatch(row.id, 'status', value)}
            />
          )}
          {isProposed(row) && option && (
            <span data-proposed className="mt-1 block text-label text-[var(--pm-primary)]">
              {t('stage.proposedBy')}
              {!needsReason && (row.reason ?? '').trim() ? (
                <span className="block text-[var(--on-surface-variant)]">{row.reason}</span>
              ) : null}
            </span>
          )}
          {awaitsAttempt(row, schema) ? (
            // Q1a (9 Oct): work PromptMaster can do is not left as "not run".
            <span data-awaits-run className="mt-1 block text-label text-[var(--pm-primary)]">
              {t('stage.awaitsRun')}
            </span>
          ) : row.status_source === 'model' && option && option.decided !== false && (
            <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t('stage.setByModel')}</span>
          )}
          {/* 13 Oct (Sean, 12.6): a finding "Handle them for me" left undecided says why. */}
          {!row.status && isTriageTable(schema) && findingRisk(row, schema) === 'material' && (
            <span data-left-for-you className="mt-1 block text-label text-[var(--on-surface-variant)]">
              {t('stage.leftForYou', { severity: (row.severity ?? '').trim() || t('stage.unrated') })}
            </span>
          )}
          {row.status_source === 'policy' && option && (
            <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t('stage.byPolicy')}</span>
          )}
          {row.status_source === 'sandbox' && option && (
            <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
              {row.status === schema.execution?.blocked ? t('stage.runBlocked') : t('stage.fromRun')}
            </span>
          )}
          {statusContradictsRow(row) && (
            <p role="status" data-contradiction className="mt-1 text-label text-[var(--pm-tertiary)]">
              {statusContradictsRow(row)}
            </p>
          )}
        </td>
      </tr>

      {/* The reason lives in its own row rather than a cramped cell: it is a
          sentence, and squeezing it beside a select made both unreadable.

          `ReasonField` is shared with the recommendations panel, which needs
          the identical control for the identical reason — dismissing a
          recommendation is dismissing a finding. It was extracted from here. */}
      {needsReason && (
        <tr className="@max-2xl:block">
          <td colSpan={columns.length + 1} className="px-4 pb-4 @max-2xl:block">
            <ReasonField
              id={`${row.id}-reason`}
              label={t('stage.why', { status: option?.label.toLowerCase() ?? '' })}
              value={row.reason ?? ''}
              disabled={readOnly}
              missing={reasonMissing}
              missingMessage={t('stage.reasonMissing')}
              onChange={(value) => onPatch(row.id, 'reason', value)}
            />
            {row.reason_source === 'row' && !reasonMissing && (
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                {t('stage.reasonFromRow')}
              </span>
            )}
            {row.reason_source === 'same' && !reasonMissing && (
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                {t('stage.reasonFromSame', { status: option?.label.toLowerCase() ?? '' })}
              </span>
            )}
            {!readOnly && !reasonMissing && sameMissing > 0 && onApplyReasonToSame && (
              <button
                type="button"
                onClick={onApplyReasonToSame}
                className="mt-1 block text-label text-[var(--pm-primary)] hover:underline"
              >
                {t('stage.useReason', { count: sameMissing, status: option?.label.toLowerCase() ?? '' })}
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

