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

import { useEffect, useMemo, useState, useRef } from 'react';

import { emptyItem, isBlankItem, statusOption, type StageItem } from '@/lib/workflow/stage-artifact';
import { CustomSelect } from '@/components/shared/custom-select';
import { parseItems } from '@/lib/workflow/stage-artifact';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';
import { lookupLabel } from '@/lib/workflow/stage-controls';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';

export function ListRenderer({
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
  const [items, setItems] = useState<StageItem[]>(saved);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  async function lookUp() {
    if (!onLookupItems || lookingUp) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const result = await onLookupItems(items);
      setItems(result.items);
      setLookupNote(result.message);
    } catch (e) {
      setLookupNote(e instanceof Error && e.message ? `The lookup did not work: ${e.message}` : 'The lookup did not work. Nothing was changed.');
    } finally {
      setLookingUp(false);
    }
  }

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

  // PM-06: tell the workspace about unsaved edits, so "Save changes" can lead.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    onDirtyChange?.({ dirty, save: () => saveRef.current() });
  }, [dirty, onDirtyChange]);

  function patch(id: string, key: string, value: string) {
    const mine = key === 'status' ? { status_source: 'user' } : {};
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [key]: value, ...mine } : i)));
  }

  // How far the rows can be trusted, said above them while any is still in
  // the state the model left it in (1 Oct, item 12).
  const defaultStatus = schema.statuses?.find((s) => s.modelDefault)?.value;
  const inDefault = defaultStatus ? items.filter((i) => i.status === defaultStatus).length : 0;
  const stateNote =
    schema.defaultStateNote && inDefault > 0
      ? schema.defaultStateNote.replace('{n}', String(inDefault)).replace('{total}', String(items.length))
      : null;

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
  // Which field is over, so a disabled Save says why (5 Oct: one field two
  // characters over its limit kept a whole table, lookup results and all,
  // from being saved, with nothing on the page saying so).
  const overField = overLimit
    ? schema.fields.find((f) => f.max && items.some((item) => (item[f.key] ?? '').length > f.max!))
    : undefined;

  return (
    <section aria-label={`${stage.label} work`}>
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
        compact={hideStageActions}
        label={`${label}s`}
        generating={generating}
        error={generationError}
        hasContent={items.length > 0}
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

      {items.length === 0 && !generating ? (
        <EmptyStage label={`${label}s`} />
      ) : (
        <>
        {stateNote && (
          <p role="note" className="mb-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-body text-[var(--on-surface)]">
            {stateNote}
          </p>
        )}
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
              {lookingUp ? 'Looking them up…' : lookupLabel(schema.lookup.noun)}
            </button>
            <span className="text-label text-[var(--on-surface-variant)]">
              Searches OpenAlex for each title and reads the abstract of each one it finds. Nothing is saved until you save.
            </span>
          </div>
        )}
        {lookupNote && (
          <p role="status" className="mb-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--on-surface)]">
            {lookupNote}
          </p>
        )}
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
        {schema.statuses?.some((s) => s.explain) && (
          <dl aria-label="What the statuses mean" className="mt-3 grid gap-x-4 gap-y-1 text-label sm:grid-cols-[max-content_1fr]">
            {schema.statuses.filter((s) => s.explain).map((s) => (
              <div key={s.value} className="contents">
                <dt className="text-[var(--on-surface)]">{s.label}</dt>
                <dd className="text-[var(--on-surface-variant)]">{s.explain}</dd>
              </div>
            ))}
          </dl>
        )}
        </>
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

          {onSaveItems && overField && (
            <span role="status" className="ml-auto text-label text-[var(--pm-error)]">
              Shorten “{overField.label}” to {overField.max} characters to save.
            </span>
          )}
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {schema.itemLabel} {index + 1}
        </span>
        {schema.statuses && (
          readOnly ? (
            <span className="text-label text-[var(--on-surface-variant)]">
              {statusOption(schema, item.status)?.label ?? 'Added by me — not verified'}
            </span>
          ) : (
            <div className="w-[300px] max-w-full" aria-label={`Status of ${schema.itemLabel} ${index + 1}`}>
              <CustomSelect
                value={item.status ?? ''}
                options={schema.statuses
                  .filter((s) => s.settable !== false || s.value === item.status)
                  .map((s) => ({ value: s.value, label: s.label }))}
                placeholder="Added by me — not verified"
                onChange={(value) => onPatch(item.id, 'status', value)}
              />
            </div>
          )
        )}
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
        <AutoGrowTextarea
          id={id}
          value={value}
          disabled={readOnly}
          rows={3}
          placeholder={field.hint}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
        />
      ) : (
        // A one-line field that wraps instead of scrolling sideways. An <input>
        // clipped an AI-drafted 250-character "Who they are" mid-word, with
        // nothing on screen to say the rest existed. Enter and pasted newlines
        // are dropped, so the value stays a single line.
        <AutoGrowTextarea
          id={id}
          value={value}
          disabled={readOnly}
          rows={1}
          placeholder={field.hint}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
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
