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

import { useEffect, useMemo, useState } from 'react';

import { CustomSelect } from '@/components/shared/custom-select';
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
  schema,
  versions,
  activeVersionId,
  onSelectVersion,
  onRestore,
  onSaveItems,
  generating,
  generationError,
  onGenerate,
  onCancelGeneration,
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

  const activeId = active?.id ?? null;
  useEffect(() => {
    setRows(parseItems(active?.content) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved]);
  const statuses = schema.statuses ?? [];
  const triaged = rows.filter((r) => isTriaged(r, schema)).length;
  const outstanding = rows.length - triaged;

  function patch(id: string, key: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
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

  const columns = schema.fields;

  return (
    <section aria-label={`${stage.label} artifact`}>
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
        label={`${schema.itemLabel}s`}
        generating={generating}
        error={generationError}
        hasContent={rows.length > 0}
        onGenerate={requestGenerate}
        onCancel={onCancelGeneration}
        readOnly={readOnly}
      />

      <VersionBar
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
          </div>

          {/* The table scrolls inside its own container: at five columns it is
              wider than the 820px content well on a laptop, and a horizontally
              scrolling page is worse than a horizontally scrolling table. */}
          <div className="overflow-x-auto rounded-xl bg-[var(--surface-container-lowest)]">
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
      <tr className="align-top">
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
              options={statuses.map((s) => ({ value: s.value, label: s.label }))}
              placeholder="Not looked at"
              onChange={(value) => onPatch(row.id, 'status', value)}
            />
          )}
        </td>
      </tr>

      {/* The reason lives in its own row rather than a cramped cell: it is a
          sentence, and squeezing it beside a select made both unreadable. */}
      {needsReason && (
        <tr>
          <td colSpan={columns.length + 1} className="px-4 pb-4">
            <label
              htmlFor={`${row.id}-reason`}
              className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
            >
              Why {option?.label.toLowerCase()}?
            </label>
            <textarea
              id={`${row.id}-reason`}
              value={row.reason ?? ''}
              disabled={readOnly}
              rows={2}
              placeholder="One sentence is enough."
              aria-invalid={reasonMissing}
              onChange={(e) => onPatch(row.id, 'reason', e.target.value)}
              className={`w-full resize-y rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40 ${
                reasonMissing ? 'ring-1 ring-[var(--pm-tertiary)]' : ''
              }`}
            />
            {reasonMissing && (
              <p className="mt-1 text-label text-[var(--pm-tertiary)]">
                This one still counts as unresolved until you say why.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
