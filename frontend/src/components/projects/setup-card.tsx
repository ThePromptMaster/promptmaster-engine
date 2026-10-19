'use client';

import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { PITCH, WorkflowPicker } from '@/components/projects/workflow-picker';
import { MODE_DISPLAY } from '@/lib/constants';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { ModeType, SetupRationale } from '@/types';
import { LimitCounter } from '@/components/shared/limit-counter';
import { INPUT_LIMITS, withinLimit } from '@/lib/projects/input-limits';


/** Added to the output format by "Keep it concise". */
const CONCISE = 'Concise: the shortest version that covers every requirement, each point said once.';

export interface SetupDraft {
  title: string;
  objective: string;
  audience: string;
  constraints: string;
  output_format: string;
  /** Source material behind the objective (4 Oct, item 7); may be long. */
  context: string;
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
  /** Shown under the workflow picker: designing one of your own. */
  designer?: React.ReactNode;
  /**
   * The Start button, placed under the recommendation when there is one: a
   * first-time user can start from the top without reading a form (Harold, via
   * Sean, 9 Oct: "keep the question tree simple and easy").
   */
  start?: React.ReactNode;
  /**
   * The simple start (Sean, 18 Oct, email 7): what you will get and Start on
   * one screen, everything else under "More options".
   */
  simple?: boolean;
}

/** Said beside Start, so nobody wonders whether they get a prompt to paste elsewhere (email 7). */
export const DOES_THE_WORK = 'PromptMaster writes the result itself; you review and approve.';

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
  designer,
  start,
  simple = false,
}: Props) {
  const field =
    'w-full rounded-lg bg-[var(--surface-container-low)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]/70 focus:ring-2 focus:ring-[var(--pm-primary)]/40';
  const label = 'mb-1.5 block text-label uppercase tracking-wider text-[var(--on-surface-variant)]';
  const why = (text?: string) =>
    text ? <p className="mt-1 text-label text-[var(--on-surface-variant)]">{text}</p> : null;

  const recommended = templates.find((t) => t.key === recommendedKey) ?? templates.find((t) => t.id === templateId);

  const full = (
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
        {start && !simple && (
          <div className="mb-6">
            {start}
            <p className="mt-2 text-label text-[var(--on-surface-variant)]">
              Or adjust anything below first — all of it is optional, and stays editable in the project.
            </p>
          </div>
        )}
        <WorkflowPicker templates={templates} selectedId={templateId} onSelect={onSelectTemplate} />
        {designer}
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
          onChange={(e) => onChange({ objective: withinLimit('objective', e.target.value) })}
          rows={2}
          aria-label="Objective"
          className="mt-3 w-full bg-transparent text-body leading-relaxed text-[var(--on-surface-variant)] outline-none"
        />
        <LimitCounter length={draft.objective.length} limit={INPUT_LIMITS.objective} />
      </div>
      </section>

      <section>
        <label htmlFor="setup-context" className={label}>Project context</label>
        <p className="mb-2 text-label text-[var(--on-surface-variant)]">
          {draft.context.trim()
            ? 'What you pasted is kept here in full, and every stage can quote it. The objective above is its opening — edit it to say what you want decided.'
            : 'Optional. Facts, figures and background the work should draw on — paste them here rather than into the objective.'}
        </p>
        {/* Scrolls rather than grows: a pasted brief can run to pages. */}
        <textarea id="setup-context" value={draft.context} rows={draft.context ? 10 : 3}
          placeholder="E.g. revenue by plant, the last three years' margins, what the board has already ruled out."
          onChange={(e) => onChange({ context: withinLimit('context', e.target.value) })}
          className={`${field} max-h-96 resize-y overflow-y-auto`} />
        <p className="mt-1 text-right text-label text-[var(--outline)]">
          {draft.context.length.toLocaleString()} / {INPUT_LIMITS.context.toLocaleString()}
        </p>
      </section>

      {rationale && (
        <p className="text-body text-[var(--on-surface-variant)]">
          <span className="material-symbols-outlined mr-1 align-[-4px] text-[18px] text-[var(--pm-primary)]" aria-hidden>
            edit_note
          </span>
          Suggested from your brief — read these and change anything that is wrong. They travel into every stage.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-3">
        <section>
          <label htmlFor="setup-audience" className={label}>Audience</label>
          <AutoGrowTextarea id="setup-audience" value={draft.audience} rows={2}
            onChange={(e) => onChange({ audience: withinLimit('audience', e.target.value) })} className={field} />
          <LimitCounter length={draft.audience.length} limit={INPUT_LIMITS.audience} />
          {why(rationale?.audience)}
        </section>
        <section>
          <label htmlFor="setup-constraints" className={label}>Constraints</label>
          <AutoGrowTextarea id="setup-constraints" value={draft.constraints} rows={2}
            placeholder="What must it do, avoid, or stay inside?"
            onChange={(e) => onChange({ constraints: withinLimit('constraints', e.target.value) })} className={field} />
          <LimitCounter length={draft.constraints.length} limit={INPUT_LIMITS.constraints} />
          {/* A suggestion is not a requirement until the user keeps it (Sean, 10 Oct, email 6.11). */}
          {rationale?.constraints && draft.constraints.trim() && (
            <p data-suggested className="mt-1 text-label text-[var(--pm-tertiary)]">
              Suggested by PromptMaster, not something you said. Keep it, edit it, or clear it — what is here when you
              press Start becomes a requirement every stage follows.
            </p>
          )}
          {why(rationale?.constraints)}
        </section>
        <section>
          <label htmlFor="setup-format" className={label}>Output format</label>
          <AutoGrowTextarea id="setup-format" value={draft.output_format} rows={2}
            placeholder="Length, structure, tone."
            onChange={(e) => onChange({ output_format: withinLimit('output_format', e.target.value) })} className={field} />
          <LimitCounter length={draft.output_format.length} limit={INPUT_LIMITS.output_format} />
          {/* For a reader new to the task (Sean, 10 Oct: an 18,818-character workshop brief). */}
          {!draft.output_format.includes(CONCISE) && (
            <button
              type="button"
              onClick={() => onChange({ output_format: withinLimit('output_format', [draft.output_format.trim(), CONCISE].filter(Boolean).join(' ')) })}
              className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--surface-container-high)] px-3 py-1 text-label text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">compress</span>
              Keep it concise
            </button>
          )}
          {why(rationale?.output_format)}
        </section>
      </div>
    </div>
  );

  if (!simple) return full;

  const suggestedConstraints = Boolean(rationale?.constraints && draft.constraints.trim());
  // What Start will create: the workflow picked under More options, not the
  // recommendation it replaced (19 Oct, production: "Start Research" under a
  // card still describing Single output).
  const chosen = templates.find((t) => t.id === templateId) ?? recommended;
  const isRecommended = !recommendedKey || chosen?.key === recommendedKey;
  const recommendedName = templates.find((t) => t.key === recommendedKey)?.name ?? recommendedKey;
  return (
    <div className="space-y-6">
      <section aria-label="What you will get" className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5">
        <p className={label}>What you&apos;ll get</p>
        {chosen && (
          <p className="text-title text-[var(--on-surface)]">
            {chosen.name}
            <span className="font-normal text-[var(--on-surface-variant)]"> — {PITCH[chosen.key] ?? chosen.description}</span>
          </p>
        )}
        {isRecommended
          ? workflowReason && <p className="mt-1 text-body text-[var(--on-surface-variant)]">{workflowReason}</p>
          : <p className="mt-1 text-body text-[var(--on-surface-variant)]">You chose this instead of the recommended {recommendedName}.</p>}
        <p className="mt-3 text-body text-[var(--on-surface)]">{draft.objective}</p>
        {suggestedConstraints && (
          <p data-suggested className="mt-3 text-label text-[var(--pm-tertiary)]">
            PromptMaster also suggested some constraints you did not say. They become requirements when you press
            Start — check them under More options.
          </p>
        )}
      </section>
      {start && (
        <div>
          {start}
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">{DOES_THE_WORK} Everything stays editable in the project.</p>
        </div>
      )}
      <details data-more-options className="rounded-2xl bg-[var(--surface-container-low)] px-6 py-4">
        <summary className="cursor-pointer text-body text-[var(--on-surface)]">
          More options
          <span className="ml-2 text-label text-[var(--on-surface-variant)]">workflow, how it thinks, name, context, audience, constraints, format</span>
        </summary>
        <div className="mt-6">{full}</div>
      </details>
    </div>
  );
}
