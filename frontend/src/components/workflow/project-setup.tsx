'use client';

/**
 * The project's setup fields, offered on the stage whose exit criteria ask for
 * them.
 *
 * This is the one thing the legacy Input phase did that had no home in the
 * workspace. Every template declares a `field_non_empty` criterion on its first
 * stage — "Objective is stated" in Book and single output, "Question is stated"
 * in Research — and until now nothing in the workspace could satisfy it: the
 * only objective editor in the app lived in the single-output pane the project
 * page passed as `children`, so a Book project had a blocking gate with no
 * control that could open it.
 *
 * Which fields appear is read from the criteria, not from the workflow. A stage
 * that names `objective` gets an objective box; a template that one day names
 * something else gets that instead, with no change here. The remaining setup
 * fields ride along because `use-stage-generation` puts all of them into the
 * PMInput for *every* stage of *every* workflow — they are project-level
 * context, so hiding them would mean the model is steered by values the user
 * cannot see.
 *
 * Edits go straight to `patchProject`, which debounces and versions nothing:
 * these are project columns, not artifact content. Only the artifact is
 * append-only.
 */

import type { MessageKey } from '@/lib/i18n/messages/en';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { useMemo } from 'react';

import type { StageDefinition } from '@/lib/workflow/types';
import type { Project, ProjectPatch, Thinking } from '@/types/project';
import { LANGUAGES, resolveLanguage, type LanguageCode } from '@/lib/workflow/languages';
import { ACCENTS } from '@/lib/appearance/colours';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { LimitCounter } from '@/components/shared/limit-counter';
import { INPUT_LIMITS, withinLimit } from '@/lib/projects/input-limits';
import { DEFAULT_MODEL, MODEL_CHOICES, currentModel } from '@/lib/constants';

/** The project columns a criterion is allowed to require, and how to label one. */
const FIELDS = {
  objective: {
    label: 'Objective',
    placeholder: 'What are you trying to produce, and why?',
    rows: 3,
  },
  audience: {
    label: 'Audience',
    placeholder: 'Who reads this, and what do they already know?',
    rows: 2,
  },
  constraints: {
    label: 'Constraints',
    placeholder: 'What must it do, avoid, or stay inside?',
    rows: 2,
  },
  output_format: {
    label: 'Output format',
    placeholder: 'Length, structure, tone.',
    rows: 2,
  },
  // 4 Oct, item 7: the material behind the objective, kept apart from it.
  context: {
    label: 'Project context — facts, figures, background',
    placeholder: 'Source material every stage may quote. Optional.',
    rows: 3,
  },
} as const;

type FieldKey = keyof typeof FIELDS;

const ORDER: FieldKey[] = ['objective', 'audience', 'constraints', 'output_format', 'context'];

function isFieldKey(key: string): key is FieldKey {
  return key in FIELDS;
}

/**
 * The fields this stage's exit criteria require.
 *
 * Exported so the workspace can ask "does this stage need the setup panel at
 * all" without duplicating the rule, and so a test can assert the wiring
 * against the real templates rather than a fixture.
 */
export function requiredFields(stage: StageDefinition | undefined): FieldKey[] {
  if (!stage) return [];
  const found: FieldKey[] = [];
  for (const criterion of stage.exit_criteria) {
    const rule = criterion.rule;
    if (rule?.type !== 'field_non_empty') continue;
    if (isFieldKey(rule.field) && !found.includes(rule.field)) found.push(rule.field);
  }
  return found;
}

/** True when this stage is one the setup panel belongs on. */
export function stageWantsSetup(stage: StageDefinition | undefined): boolean {
  return requiredFields(stage).length > 0;
}

interface Props {
  project: Project;
  stage: StageDefinition;
  onPatch: (patch: ProjectPatch) => void;
  /** Browsing an earlier stage: readable, not editable. */
  readOnly: boolean;
}

/** A field's label and placeholder in the interface's language. */
function useFieldText() {
  const t = useT();
  return (key: FieldKey) => ({ label: t(`brief.field.${key}`), placeholder: t(`brief.field.${key}Hint`) });
}

export function ProjectSetup({ project, stage, onPatch, readOnly }: Props) {
  const t = useT();
  const text = useFieldText();
  const required = useMemo(() => requiredFields(stage), [stage]);
  if (required.length === 0) return null;

  return (
    <section
      aria-label={t('brief.setupLabel')}
      className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-6"
    >
      <h3 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        {t('brief.setupLabel')}
      </h3>
      <p className="mt-1 mb-5 text-label text-[var(--on-surface-variant)]">
        {t('brief.setupExplain')}
      </p>

      <div className="space-y-5">
        {ORDER.map((key) => {
          const field = { ...FIELDS[key], ...text(key) };
          const isRequired = required.includes(key);
          const value = project[key] ?? '';

          return (
            <div key={key}>
              {/* The hint sits beside the label, not inside it: a label whose
                  accessible name drifts with the field's own value is one no
                  screen reader user — or test — can address by name. */}
              <div className="mb-1.5 flex items-center gap-2">
                <label
                  htmlFor={`setup-${key}`}
                  className="text-label text-[var(--on-surface-variant)]"
                >
                  {field.label}
                </label>
                {isRequired && (
                  <span aria-hidden className="text-label text-[var(--pm-tertiary)]">
                    {value.trim() ? t('brief.required') : t('brief.requiredWaiting')}
                  </span>
                )}
              </div>
              <AutoGrowTextarea
                id={`setup-${key}`}
                value={value}
                readOnly={readOnly}
                rows={field.rows}
                placeholder={field.placeholder}
                onChange={(e) => onPatch({ [key]: withinLimit(key, e.target.value) })}
                className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/40 read-only:opacity-70"
              />
              {!readOnly && <LimitCounter length={value.length} limit={INPUT_LIMITS[key]} />}
            </div>
          );
        })}
        {/* The first stage shows this instead of the brief, so the model is set here too (18 Oct, pilot). */}
        <ModelChoice model={project.model} readOnly={readOnly} onPick={(model) => onPatch({ model })} />
        <ThinkingChoice thinking={project.thinking} readOnly={readOnly} onPick={(thinking) => onPatch({ thinking })} />
        <LanguageChoice language={project.language} readOnly={readOnly} onPick={(language) => onPatch({ language })} />
        <AccentChoice accent={project.accent} readOnly={readOnly} onPick={(accent) => onPatch({ accent })} />
      </div>
    </section>
  );
}

/**
 * The project brief on every other stage (PM-10).
 *
 * Objective, audience, constraints and output format used to be editable only
 * on the first stage, which made them feel like a form filled in once rather
 * than the thing every stage is generated against. Collapsed by default so it
 * costs one line; open, it is the same four fields.
 */
export function ProjectBrief({ project, onPatch, readOnly }: Omit<Props, 'stage'>) {
  const t = useT();
  const text = useFieldText();
  const objective = project.objective.trim();
  return (
    <details className="group mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-body text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined text-[18px] transition-transform group-open:rotate-90">
          chevron_right
        </span>
        <span className="shrink-0 text-label uppercase tracking-wider">{t('brief.title')}</span>
        <span className="min-w-0 truncate text-[var(--on-surface)]">
          {objective || t('brief.noObjective')}
        </span>
        {project.audience && (
          <span className="hidden shrink-0 text-label sm:inline">{t('brief.for', { audience: project.audience })}</span>
        )}
      </summary>
      <p className="mt-3 mb-4 text-label text-[var(--on-surface-variant)]">
        {t('brief.explain')}
      </p>
      <div className="space-y-4">
        {ORDER.map((key) => {
          const field = { ...FIELDS[key], ...text(key) };
          return (
            <div key={key}>
              <label htmlFor={`brief-${key}`} className="mb-1.5 block text-label text-[var(--on-surface-variant)]">
                {field.label}
              </label>
              {key === 'context' ? (
                <textarea
                  id="brief-context"
                  value={project.context ?? ''}
                  readOnly={readOnly}
                  rows={project.context ? 8 : 2}
                  placeholder={field.placeholder}
                  onChange={(e) => onPatch({ context: withinLimit('context', e.target.value) })}
                  className="max-h-96 w-full resize-y overflow-y-auto rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/40 read-only:opacity-70"
                />
              ) : (
              <AutoGrowTextarea
                id={`brief-${key}`}
                value={project[key] ?? ''}
                readOnly={readOnly}
                rows={1}
                placeholder={field.placeholder}
                onChange={(e) => onPatch({ [key]: withinLimit(key, e.target.value) })}
                className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/40 read-only:opacity-70"
              />
              )}
              {!readOnly && <LimitCounter length={(project[key] ?? '').length} limit={INPUT_LIMITS[key]} />}
            </div>
          );
        })}
        <ModelChoice model={project.model} readOnly={readOnly} onPick={(model) => onPatch({ model })} />
        <ThinkingChoice thinking={project.thinking} readOnly={readOnly} onPick={(thinking) => onPatch({ thinking })} />
        <LanguageChoice language={project.language} readOnly={readOnly} onPick={(language) => onPatch({ language })} />
        <AccentChoice accent={project.accent} readOnly={readOnly} onPick={(accent) => onPatch({ accent })} />
      </div>
    </details>
  );
}

/** Which model writes and checks this project's work; every request already carries it. */
/**
 * The project's own colour (14 Oct call: "the whole thing could change color
 * based on what project you're working on"). Its buttons, selected version and
 * card take it; "Mine" follows the colours chosen in the account menu.
 */
function AccentChoice({ accent, readOnly, onPick }: { accent: string | null | undefined; readOnly?: boolean; onPick: (accent: string | null) => void }) {
  const t = useT();
  const current = ACCENTS.some((a) => a.id === accent) ? accent : null;
  return (
    <fieldset disabled={readOnly}>
      <legend className="mb-1.5 block text-label text-[var(--on-surface-variant)]">{t('brief.colour')}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-pressed={current === null}
          className={`rounded-full px-3 py-1 text-label ${current === null ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]' : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)]'}`}
        >
          {t('brief.colourMine')}
        </button>
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a.id)}
            aria-pressed={current === a.id}
            aria-label={t('brief.colourNamed', { name: t(`colour.${a.id}` as MessageKey) })}
            title={t(`colour.${a.id}` as MessageKey)}
            className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${current === a.id ? 'ring-2 ring-[var(--on-surface)] ring-offset-2 ring-offset-[var(--surface-container-lowest)]' : ''}`}
            style={{ background: a.colour }}
          />
        ))}
      </div>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('brief.colourHint')}</p>
    </fieldset>
  );
}

/**
 * How hard the model thinks (14 Oct call: "increase the thinking level or
 * effort"). Deep reasons at high effort on every call this project makes:
 * slower and dearer, and the usage page shows by how much.
 */
function ThinkingChoice({ thinking, readOnly, onPick }: { thinking: Thinking | undefined; readOnly?: boolean; onPick: (thinking: Thinking) => void }) {
  const t = useT();
  return (
    <div>
      <label htmlFor="brief-thinking" className="mb-1.5 block text-label text-[var(--on-surface-variant)]">
        {t('brief.thinking')}
      </label>
      <select
        id="brief-thinking"
        value={thinking ?? 'standard'}
        disabled={readOnly}
        onChange={(e) => onPick(e.target.value === 'deep' ? 'deep' : 'standard')}
        className="rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40 disabled:opacity-70"
      >
        <option value="standard">{t('brief.thinkingStandard')}</option>
        <option value="deep">{t('brief.thinkingDeep')}</option>
      </select>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        {t('brief.thinkingHint')}
      </p>
    </div>
  );
}

/**
 * The language the work is written in (client, 21 Oct: "Can we do pick your
 * language?"): every draft, check, chat answer and Go step from here on.
 */
export function LanguageChoice({ language, readOnly, onPick, id = 'brief-language' }: { language: string | undefined; readOnly?: boolean; onPick: (language: LanguageCode) => void; id?: string }) {
  const t = useT();
  const locale = useLocale();
  // Each language by its own name, then by the interface's name for it.
  const named = (code: string, fallback: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? fallback;
    } catch {
      return fallback;
    }
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-label text-[var(--on-surface-variant)]">
        {t('brief.writesIn')}
      </label>
      <select
        id={id}
        value={resolveLanguage(language)}
        disabled={readOnly}
        onChange={(e) => onPick(resolveLanguage(e.target.value))}
        className="rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40 disabled:opacity-70"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.code === locale ? l.own : `${l.own} — ${named(l.code, l.name)}`}</option>
        ))}
      </select>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        {t('brief.writesInHint')}
      </p>
    </div>
  );
}

function ModelChoice({ model, readOnly, onPick }: { model: string | null | undefined; readOnly?: boolean; onPick: (model: string) => void }) {
  const t = useT();
  const current = currentModel(model) || DEFAULT_MODEL;
  const choices = MODEL_CHOICES.some((c) => c.id === current) ? MODEL_CHOICES : [...MODEL_CHOICES, { id: current, label: current }];
  return (
    <div>
      <label htmlFor="brief-model" className="mb-1.5 block text-label text-[var(--on-surface-variant)]">
        {t('brief.model')}
      </label>
      <select
        id="brief-model"
        value={current}
        disabled={readOnly}
        onChange={(e) => onPick(e.target.value)}
        className="rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40 disabled:opacity-70"
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('brief.modelHint')}</p>
    </div>
  );
}
