'use client';

import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { WorkflowPicker } from '@/components/projects/workflow-picker';
import { MODE_DISPLAY } from '@/lib/constants';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { ModeType, SetupRationale } from '@/types';

export interface SetupDraft {
  title: string;
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;
  mode: ModeType;
}

interface Props {
  templates: (WorkflowTemplate & { id: string })[];
  templateId: string | null;
  onSelectTemplate: (id: string) => void;
  /** Why the recommended workflow fits; empty when the user chose it. */
  workflowReason: string;
  recommendedKey: string | null;
  draft: SetupDraft;
  rationale: SetupRationale | null;
  onChange: (patch: Partial<SetupDraft>) => void;
}

const SELECTABLE_MODES = (Object.keys(MODE_DISPLAY) as ModeType[]).filter((m) => m !== 'custom');

/**
 * PM-09: the recommended setup, every part of it editable before anything is
 * created. Each recommendation carries its reason — a suggestion without one
 * is just another thing telling you what to do.
 */
export function SetupCard({
  templates,
  templateId,
  onSelectTemplate,
  workflowReason,
  recommendedKey,
  draft,
  rationale,
  onChange,
}: Props) {
  const field =
    'w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]/70 focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const label = 'mb-1.5 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]';
  const why = (text?: string) =>
    text ? <p className="mt-1 text-label text-[var(--on-surface-variant)]">{text}</p> : null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className={label}>Workflow</h2>
        {recommendedKey && workflowReason && (
          <p className="mb-3 text-body text-[var(--on-surface)]">
            <span className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-primary)]" aria-hidden>
              recommend
            </span>
            Recommended: <strong>{templates.find((t) => t.key === recommendedKey)?.name ?? recommendedKey}</strong>
            {' — '}
            {workflowReason}
          </p>
        )}
        <WorkflowPicker templates={templates} selectedId={templateId} onSelect={onSelectTemplate} />
      </section>

      <section>
        <label htmlFor="setup-mode" className={label}>
          How PromptMaster should think
        </label>
        <select
          id="setup-mode"
          value={draft.mode}
          onChange={(e) => onChange({ mode: e.target.value as ModeType })}
          className={field}
        >
          {SELECTABLE_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_DISPLAY[m].display_name} — {MODE_DISPLAY[m].tagline}
            </option>
          ))}
        </select>
        {why(rationale?.mode)}
      </section>

      <section>
      <h2 className={label}>Name and objective</h2>
      <div className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
        <input
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Give it a name"
          aria-label="Project name"
          className="w-full bg-transparent text-headline text-[var(--on-surface)] outline-none placeholder:text-[var(--outline)]"
        />
        <AutoGrowTextarea
          value={draft.objective}
          onChange={(e) => onChange({ objective: e.target.value })}
          rows={2}
          aria-label="Objective"
          className="mt-3 w-full bg-transparent text-body leading-relaxed text-[var(--on-surface-variant)] outline-none"
        />
      </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <section>
          <label htmlFor="setup-audience" className={label}>Audience</label>
          <AutoGrowTextarea id="setup-audience" value={draft.audience} rows={2}
            onChange={(e) => onChange({ audience: e.target.value })} className={field} />
          {why(rationale?.audience)}
        </section>
        <section>
          <label htmlFor="setup-constraints" className={label}>Constraints</label>
          <AutoGrowTextarea id="setup-constraints" value={draft.constraints} rows={2}
            placeholder="What must it do, avoid, or stay inside?"
            onChange={(e) => onChange({ constraints: e.target.value })} className={field} />
          {why(rationale?.constraints)}
        </section>
        <section>
          <label htmlFor="setup-format" className={label}>Output format</label>
          <AutoGrowTextarea id="setup-format" value={draft.output_format} rows={2}
            placeholder="Length, structure, tone."
            onChange={(e) => onChange({ output_format: e.target.value })} className={field} />
          {why(rationale?.output_format)}
        </section>
      </div>
    </div>
  );
}
