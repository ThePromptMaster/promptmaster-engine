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

import { useMemo } from 'react';

import type { StageDefinition } from '@/lib/workflow/types';
import type { Project, ProjectPatch } from '@/types/project';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';

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
} as const;

type FieldKey = keyof typeof FIELDS;

const ORDER: FieldKey[] = ['objective', 'audience', 'constraints', 'output_format'];

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

export function ProjectSetup({ project, stage, onPatch, readOnly }: Props) {
  const required = useMemo(() => requiredFields(stage), [stage]);
  if (required.length === 0) return null;

  return (
    <section
      aria-label="Project setup"
      className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-6"
    >
      <h3 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Project setup
      </h3>
      <p className="mt-1 mb-5 text-label text-[var(--on-surface-variant)]">
        Carried into every stage of this project, not just this one.
      </p>

      <div className="space-y-5">
        {ORDER.map((key) => {
          const field = FIELDS[key];
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
                    {value.trim() ? 'required' : 'required — this stage is waiting on it'}
                  </span>
                )}
              </div>
              <AutoGrowTextarea
                id={`setup-${key}`}
                value={value}
                readOnly={readOnly}
                rows={field.rows}
                placeholder={field.placeholder}
                onChange={(e) => onPatch({ [key]: e.target.value })}
                className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/40 read-only:opacity-70"
              />
            </div>
          );
        })}
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
  const objective = project.objective.trim();
  return (
    <details className="group mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-body text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined text-[18px] transition-transform group-open:rotate-90">
          chevron_right
        </span>
        <span className="shrink-0 text-label uppercase tracking-wider">Project brief</span>
        <span className="min-w-0 truncate text-[var(--on-surface)]">
          {objective || 'No objective yet'}
        </span>
        {project.audience && (
          <span className="hidden shrink-0 text-label sm:inline">· for {project.audience}</span>
        )}
      </summary>
      <p className="mt-3 mb-4 text-label text-[var(--on-surface-variant)]">
        Every stage is written against this. Change it here and the next draft follows.
      </p>
      <div className="space-y-4">
        {ORDER.map((key) => {
          const field = FIELDS[key];
          return (
            <div key={key}>
              <label htmlFor={`brief-${key}`} className="mb-1.5 block text-label text-[var(--on-surface-variant)]">
                {field.label}
              </label>
              <AutoGrowTextarea
                id={`brief-${key}`}
                value={project[key] ?? ''}
                readOnly={readOnly}
                rows={1}
                placeholder={field.placeholder}
                onChange={(e) => onPatch({ [key]: e.target.value })}
                className="w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/40 read-only:opacity-70"
              />
            </div>
          );
        })}
      </div>
    </details>
  );
}
