'use client';

/**
 * Assess stages: paste one or more items, get a verdict on each (client,
 * 25 Oct: screening LinkedIn profiles a few at a time, colour-coded).
 *
 * The scale, the criteria and the item noun are data — the stage's `assess`
 * spec and the earlier stages — so this renders a candidate screen, a supplier
 * shortlist or a grant triage alike, and never asks which workflow it is in.
 * Every batch appends; a verdict the user changes keeps the model's beside it.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  ASSESS_PASTE_MAX,
  SCALE_LIMITS,
  SCALE_PRESETS,
  assessmentCsv,
  customScale,
  levelOf,
  parseAssessment,
  scaleFromSpec,
  serializeAssessment,
  setVerdict,
  sortByVerdict,
  validScale,
  verdictCounts,
  type AssessScale,
} from '@/lib/workflow/assess';
import type { StageItem } from '@/lib/workflow/stage-artifact';
import { downloadFile } from '@/lib/utils';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { CustomSelect } from '@/components/shared/custom-select';
import { LimitCounter } from '@/components/shared/limit-counter';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { shownSchema, stageText, templateWord } from '@/lib/i18n/templates';
import { VerdictChip } from '../verdict-chip';
import { VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';

type Filter = { kind: 'all' } | { kind: 'level'; label: string };

export function AssessRenderer({
  stage,
  templateKey,
  schema: ownSchema,
  versions,
  evaluation,
  activeVersionId,
  onSelectVersion,
  onRestore,
  onSaveContent,
  onAssessBatch,
  readOnly,
}: StageRendererProps) {
  const t = useT();
  const locale = useLocale();
  const schema = useMemo(() => shownSchema(locale, ownSchema), [locale, ownSchema]);
  const label = (key: string) => schema.fields.find((f) => f.key === key)?.label ?? key;
  const word = (english: string) => templateWord(locale, english);

  const active = useMemo(
    () => versions.find((v) => v.id === activeVersionId) ?? versions.at(-1) ?? null,
    [versions, activeVersionId]
  );
  const isHead = !active || active.id === versions.at(-1)?.id;
  const doc = useMemo(() => parseAssessment(active?.content), [active]);
  const items = useMemo(() => doc?.items ?? [], [doc]);

  // The scale is fixed by the first batch: verdicts on one table must be
  // comparable. Until then the user may pick another.
  const offered = useMemo(() => scaleFromSpec(stage.assess), [stage.assess]);
  const [picked, setPicked] = useState<AssessScale>(offered);
  const [customText, setCustomText] = useState('');
  const locked = Boolean(doc?.scale && items.length > 0);
  const scale: AssessScale = (locked ? doc?.scale : null) ?? doc?.scale ?? picked;

  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [bestFirst, setBestFirst] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // A new version on screen (a batch saved, a restore) starts from its own filter.
  const activeId = active?.id ?? null;
  useEffect(() => {
    setFilter({ kind: 'all' });
  }, [activeId]);

  const editable = !readOnly && isHead;
  const counts = verdictCounts(scale, items);
  const shown = useMemo(() => {
    const kept = filter.kind === 'all' ? items : items.filter((i) => (filter.label ? i.verdict === filter.label : !levelOf(scale, i.verdict)));
    return bestFirst ? sortByVerdict(scale, kept) : [...kept].reverse();
  }, [items, filter, bestFirst, scale]);
  const stageName = stageText(locale, templateKey, stage, 'label');
  const noun = stage.assess?.item_noun?.trim();

  async function run() {
    if (!onAssessBatch || !text.trim() || running || !validScale(scale)) return;
    setRunning(true);
    setNote(null);
    try {
      const said = await onAssessBatch({ text: text.trim(), scale, existing: items });
      setText('');
      setNote({ text: said });
    } catch (e) {
      setNote({ text: t('assess.failed', { why: e instanceof Error && e.message ? e.message : t('assess.failedUnknown') }), error: true });
    } finally {
      setRunning(false);
    }
  }

  async function save(next: StageItem[]) {
    if (!onSaveContent || saving) return;
    setSaving(true);
    try {
      await onSaveContent(serializeAssessment(scale, next));
    } finally {
      setSaving(false);
    }
  }

  function download() {
    const csv = assessmentCsv(sortByVerdict(scale, items), {
      subject: label('subject'), verdict: label('verdict'), rationale: label('rationale'), evidence: label('evidence'),
      gaps: label('gaps'), batch: t('assess.batchCol'), assessed_at: t('assess.dateCol'),
    });
    downloadFile(csv, `${stage.label.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'table'}.csv`, 'text/csv');
  }

  const verdictOptions = scale.levels.map((l) => ({ value: l.label, label: word(l.label) }));

  return (
    <div className="space-y-5">
      <VersionBar
        versions={versions}
        activeVersionId={activeVersionId}
        headVersionId={versions.at(-1)?.id ?? null}
        onSelect={onSelectVersion}
        onRestore={onRestore}
        readOnly={readOnly}
        evaluation={evaluation}
      />

      {editable && onAssessBatch && (
        <section aria-label={t('assess.newBatch')} className="rounded-xl bg-[var(--surface-container-low)] p-5">
          {!locked && (
            <ScalePicker
              picked={picked}
              customText={customText}
              onPick={(s) => setPicked(s)}
              onCustom={(v) => {
                setCustomText(v);
                setPicked(customScale(v));
              }}
            />
          )}
          <label htmlFor="assess-paste" className="mt-1 block text-label font-semibold text-[var(--on-surface)]">
            {noun ? t('assess.pasteNamed', { noun }) : t('assess.paste')}
          </label>
          <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{t('assess.pasteHint')}</p>
          <AutoGrowTextarea
            id="assess-paste"
            value={text}
            maxLength={ASSESS_PASTE_MAX}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={t('assess.placeholder')}
            className="mt-2 max-h-[40vh] w-full resize-none overflow-y-auto rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]"
          />
          <LimitCounter length={text.length} limit={ASSESS_PASTE_MAX} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || !text.trim() || !validScale(scale)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-40"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">fact_check</span>
              {running ? t('assess.running') : t('assess.run')}
            </button>
            {locked && (
              <span className="flex flex-wrap items-center gap-1.5 text-label text-[var(--on-surface-variant)]">
                {t('assess.judgedOn')}
                {scale.levels.map((l) => <VerdictChip key={l.label} label={word(l.label)} tone={l.tone} />)}
              </span>
            )}
          </div>
          {note && (
            <p role="status" className={`mt-2 text-label ${note.error ? 'text-[var(--pm-error)]' : 'text-[var(--on-surface-variant)]'}`}>
              {note.text}
            </p>
          )}
        </section>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface-container-lowest)] px-6 py-10 text-center text-body text-[var(--on-surface-variant)]">
          {editable ? t('assess.empty') : t('assess.emptyRead')}
        </p>
      ) : (
        <section aria-label={t('assess.results', { stage: stageName })} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t('assess.filter')} className="flex flex-wrap gap-1.5">
              <FilterButton active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
                {t('assess.all', { n: items.length })}
              </FilterButton>
              {counts.map((c) => (
                <FilterButton
                  key={c.label || '-'}
                  active={filter.kind === 'level' && filter.label === c.label}
                  onClick={() => setFilter({ kind: 'level', label: c.label })}
                >
                  <VerdictChip label={c.label ? word(c.label) : t('assess.ungradedLabel')} tone={c.tone} count={c.count} />
                </FilterButton>
              ))}
            </div>
            <div className="ms-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBestFirst((b) => !b)}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">sort</span>
                {bestFirst ? t('assess.sortBest') : t('assess.sortNewest')}
              </button>
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-label text-[var(--pm-primary)] hover:bg-[var(--surface-container-low)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">download</span>
                {t('assess.csv')}
              </button>
            </div>
          </div>

          <div className="@container overflow-x-auto rounded-xl bg-[var(--surface-container-lowest)]">
            <table className="w-full border-collapse @max-2xl:block">
              <caption className="sr-only">{t('assess.results', { stage: stageName })}</caption>
              <thead>
                <tr className="bg-[var(--surface-container-low)] @max-2xl:hidden">
                  {(['verdict', 'subject', 'rationale', 'gaps'] as const).map((k) => (
                    <th key={k} scope="col" className="px-4 py-3 text-start text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
                      {label(k)}
                    </th>
                  ))}
                  <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">{t('assess.rowActions')}</span></th>
                </tr>
              </thead>
              <tbody className="@max-2xl:block">
                {shown.map((row) => {
                  const level = levelOf(scale, row.verdict);
                  const changed = row.verdict_source === 'user' && row.model_verdict && row.model_verdict !== row.verdict;
                  return (
                    <tr key={row.id} className="align-top odd:bg-[var(--surface-container-lowest)] even:bg-[var(--surface)] @max-2xl:block @max-2xl:px-4 @max-2xl:py-3">
                      <td className="w-[170px] px-4 py-3 @max-2xl:block @max-2xl:w-auto @max-2xl:px-0 @max-2xl:py-1">
                        <VerdictChip label={level ? word(level.label) : t('assess.ungradedLabel')} tone={level?.tone ?? 'neutral'} />
                        {editable && onSaveContent && (
                          <div className="mt-1.5">
                            <CustomSelect
                              value={row.verdict ?? ''}
                              options={verdictOptions}
                              placeholder={t('assess.setVerdict')}
                              ariaLabel={t('assess.verdictFor', { item: row.subject || '' })}
                              disabled={saving}
                              onChange={(v) => void save(setVerdict(items, row.id, v))}
                            />
                          </div>
                        )}
                        {changed && (
                          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
                            {t('assess.changedFrom', { verdict: word(row.model_verdict!) })}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 @max-2xl:block @max-2xl:px-0 @max-2xl:py-1">
                        <p className="text-body font-semibold text-[var(--on-surface)]">{row.subject}</p>
                        {row.batch && (
                          <p className="mt-0.5 text-label text-[var(--outline)]">{t('assess.batch', { n: row.batch })}</p>
                        )}
                        {row.evidence && (
                          <button
                            type="button"
                            aria-expanded={Boolean(open[row.id])}
                            onClick={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
                            className="mt-1 inline-flex items-center gap-0.5 text-label text-[var(--pm-primary)]"
                          >
                            <span aria-hidden className="material-symbols-outlined text-[16px]">{open[row.id] ? 'expand_less' : 'expand_more'}</span>
                            {label('evidence')}
                          </button>
                        )}
                        {open[row.id] && (
                          <p className="mt-1 whitespace-pre-line text-label text-[var(--on-surface-variant)]">{row.evidence}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 @max-2xl:block @max-2xl:px-0 @max-2xl:py-1">
                        <p className="whitespace-pre-line text-body text-[var(--on-surface)]">{row.rationale}</p>
                      </td>
                      <td className="px-4 py-3 @max-2xl:block @max-2xl:px-0 @max-2xl:py-1">
                        {row.gaps ? (
                          <p className="whitespace-pre-line text-label text-[var(--on-surface-variant)]">
                            <span className="sr-only @max-2xl:not-sr-only @max-2xl:font-semibold">{label('gaps')}: </span>
                            {row.gaps}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-3 @max-2xl:block @max-2xl:px-0">
                        {editable && onSaveContent && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void save(items.filter((i) => i.id !== row.id))}
                            aria-label={t('assess.remove', { item: row.subject || '' })}
                            title={t('assess.remove', { item: row.subject || '' })}
                            className="rounded-lg p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
                          >
                            <span aria-hidden className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-1.5 py-1 text-label ${
        active ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)] ring-2 ring-[var(--pm-primary)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'
      }`}
    >
      {children}
    </button>
  );
}

function ScalePicker({
  picked,
  customText,
  onPick,
  onCustom,
}: {
  picked: AssessScale;
  customText: string;
  onPick: (scale: AssessScale) => void;
  onCustom: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const choices = [...SCALE_PRESETS.map((s) => s.id), 'custom'];
  const chosen = picked.id;
  return (
    <fieldset className="mb-4">
      <legend className="text-label font-semibold text-[var(--on-surface)]">{t('assess.scale')}</legend>
      <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{t('assess.scaleHint')}</p>
      <div role="radiogroup" aria-label={t('assess.scale')} className="mt-2 flex flex-wrap gap-1.5">
        {choices.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={chosen === id}
            onClick={() => (id === 'custom' ? onCustom(customText) : onPick(SCALE_PRESETS.find((s) => s.id === id)!))}
            className={`rounded-lg px-3 py-1.5 text-label ${
              chosen === id ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]' : 'bg-[var(--surface-container-lowest)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            }`}
          >
            {t(`assess.preset.${id}` as MessageKey)}
          </button>
        ))}
      </div>
      {chosen === 'custom' && (
        <div className="mt-2">
          <label htmlFor="assess-custom-scale" className="text-label text-[var(--on-surface-variant)]">
            {t('assess.customHint', { min: SCALE_LIMITS.minLevels, max: SCALE_LIMITS.maxLevels })}
          </label>
          <textarea
            id="assess-custom-scale"
            value={customText}
            rows={3}
            onChange={(e) => onCustom(e.target.value)}
            placeholder={t('assess.customPlaceholder')}
            className="mt-1 w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]"
          />
        </div>
      )}
      {validScale(picked) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.levels.map((l) => <VerdictChip key={l.label} label={templateWord(locale, l.label)} tone={l.tone} />)}
        </div>
      ) : (
        <p className="mt-2 text-label text-[var(--pm-error)]">{t('assess.scaleInvalid', { min: SCALE_LIMITS.minLevels })}</p>
      )}
    </fieldset>
  );
}
