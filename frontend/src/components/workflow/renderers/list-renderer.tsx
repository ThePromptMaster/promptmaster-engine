'use client';

/**
 * List stages: audience segments, research claims, hypotheses.
 *
 * **Schema-driven.** One component renders {who, prior_knowledge,
 * what_they_want} and {statement, prediction, disconfirming_observation}
 * because it renders whatever fields the schema declares — there is no branch
 * anywhere below on which stage or which workflow this is. That property is
 * what stops "Book's list" and "Research's list" becoming two components that
 * drift.
 *
 * The multi-field editing idiom, the character counters and the validation are
 * adapted from persona-editor.tsx; the inline delete-confirm from
 * persona-row.tsx. Both are restyled to the workflow dialect — the originals
 * use raw red/amber Tailwind, which is a second visual language.
 */

import { useEffect, useMemo, useState } from 'react';

import { emptyItem, isBlankItem, type StageItem } from '@/lib/workflow/stage-artifact';
import { parseItems } from '@/lib/workflow/stage-artifact';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';

export function ListRenderer({
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
  const [items, setItems] = useState<StageItem[]>(saved);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Re-seed from the version being displayed. Editing then browsing history
  // and coming back must not show a stale local array.
  const activeId = active?.id ?? null;
  useEffect(() => {
    setItems(parseItems(active?.content) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const dirty = useMemo(
    () => JSON.stringify(items) !== JSON.stringify(saved),
    [items, saved]
  );
  const label = schema.itemLabel;

  function patch(id: string, key: string, value: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
  }

  function add() {
    setItems((prev) => [...prev, emptyItem(schema)]);
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function move(id: string, delta: number) {
    setItems((prev) => {
      const index = prev.findIndex((i) => i.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!onSaveItems || saving) return;
    setSaving(true);
    try {
      // Blank rows are dropped on save rather than blocked while typing —
      // an empty row you added and changed your mind about should not be an
      // error message.
      await onSaveItems(items.filter((i) => !isBlankItem(i, schema)));
    } finally {
      setSaving(false);
    }
  }

  function requestGenerate() {
    if (items.length > 0) setConfirming(true);
    else onGenerate();
  }

  const overLimit = items.some((item) =>
    schema.fields.some((f) => f.max && (item[f.key] ?? '').length > f.max)
  );

  return (
    <section aria-label={`${stage.label} artifact`}>
      {confirming && (
        <ConfirmOverwrite
          label={`${label}s`}
          onConfirm={() => {
            setConfirming(false);
            onGenerate({ force: true });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      <GenerationBar
        label={`${label}s`}
        generating={generating}
        error={generationError}
        hasContent={items.length > 0}
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

      {items.length === 0 && !generating ? (
        <EmptyStage label={`${label}s`} />
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              schema={schema}
              readOnly={readOnly}
              onPatch={patch}
              onRemove={remove}
              onMove={move}
            />
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
          >
            <span aria-hidden className="material-symbols-outlined text-[16px]">
              add
            </span>
            Add another {label}
          </button>

          <span className="text-label text-[var(--on-surface-variant)]">
            {items.length} {items.length === 1 ? label : `${label}s`}
            {/* Say what the stage still expects rather than only marking it
                unmet in the checklist below. */}
            {items.length < schema.minItems && ` · ${schema.minItems} expected`}
          </span>

          {onSaveItems && (
            <button
              onClick={() => void save()}
              disabled={!dirty || saving || overLimit}
              className="ml-auto rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save as new version'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface ItemCardProps {
  item: StageItem;
  index: number;
  count: number;
  schema: StageRendererProps['schema'];
  readOnly: boolean;
  onPatch: (id: string, key: string, value: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
}

function ItemCard({
  item,
  index,
  count,
  schema,
  readOnly,
  onPatch,
  onRemove,
  onMove,
}: ItemCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (confirmDelete) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
        <span className="text-body text-[var(--on-surface)]">
          Delete this {schema.itemLabel}?
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            Keep it
          </button>
          <button
            onClick={() => onRemove(item.id)}
            className="rounded-lg bg-[var(--pm-tertiary)] px-3 py-1.5 text-label text-[var(--on-primary)]"
          >
            Delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl bg-[var(--surface-container-lowest)] px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {schema.itemLabel} {index + 1}
        </span>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => onMove(item.id, -1)}
              disabled={index === 0}
              aria-label={`Move ${schema.itemLabel} ${index + 1} up`}
              className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-30"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                arrow_upward
              </span>
            </button>
            <button
              onClick={() => onMove(item.id, 1)}
              disabled={index === count - 1}
              aria-label={`Move ${schema.itemLabel} ${index + 1} down`}
              className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-30"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                arrow_downward
              </span>
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete ${schema.itemLabel} ${index + 1}`}
              className="rounded-md p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                delete
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {schema.fields.map((field) => (
          <ItemField
            key={field.key}
            id={`${item.id}-${field.key}`}
            field={field}
            value={item[field.key] ?? ''}
            readOnly={readOnly}
            onChange={(value) => onPatch(item.id, field.key, value)}
          />
        ))}
      </div>
    </li>
  );
}

interface ItemFieldProps {
  id: string;
  field: StageRendererProps['schema']['fields'][number];
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}

export function ItemField({ id, field, value, readOnly, onChange }: ItemFieldProps) {
  const over = field.max ? value.length > field.max : false;
  const near = field.max ? value.length > field.max * 0.9 : false;

  const shared =
    'w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none transition-all placeholder:text-[var(--on-surface-variant)]/60 focus:ring-2 focus:ring-[var(--pm-primary)]/40 disabled:opacity-70';

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]"
      >
        {field.label}
      </label>
      {field.long ? (
        <textarea
          id={id}
          value={value}
          disabled={readOnly}
          rows={3}
          placeholder={field.hint}
          onChange={(e) => onChange(e.target.value)}
          className={`${shared} resize-y`}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          disabled={readOnly}
          placeholder={field.hint}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
        />
      )}
      {field.max && (
        <p
          className={`mt-1 text-right text-label ${
            over
              ? 'text-[var(--pm-tertiary)]'
              : near
                ? 'text-[var(--on-surface-variant)]'
                : 'text-[var(--on-surface-variant)] opacity-60'
          }`}
        >
          {value.length} / {field.max}
        </p>
      )}
    </div>
  );
}
