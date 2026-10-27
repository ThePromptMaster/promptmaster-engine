'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { stageText } from '@/lib/i18n/templates';
import type { MessageKey } from '@/lib/i18n/messages/en';

import type { WorkflowTemplate } from '@/lib/workflow/types';

const ICON: Record<string, string> = {
  book: 'menu_book',
  research: 'science',
  single_output: 'bolt',
  exploration: 'explore',
  assessment: 'fact_check',
  quick: 'chat',
};

/**
 * A one-line promise per workflow. The template's own description is written
 * for the stage list; this is written for someone deciding.
 */
export const PITCH: Record<string, string> = {
  book: 'Long-form writing that has to hold together across chapters.',
  research: 'An investigation where the method matters as much as the result.',
  single_output: 'One deliverable — a memo, a brief, a report — drafted, checked and finished in minutes.',
  exploration: 'An idea taken as far as it goes — round after round, tested as you go.',
  assessment: 'Criteria set once, then items judged against them in batches — on a traffic light, a score or your own scale.',
  quick: 'An answer or a draft straight away; take it into the full process whenever it needs more.',
};

interface Props {
  templates: (WorkflowTemplate & { id: string })[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Take a workflow the user designed off this list (Sean, 23 Oct). Unset, nothing can be removed. */
  onRemove?: (template: WorkflowTemplate & { id: string }) => void;
}

/**
 * A system workflow's name and pitch in the interface language (client, 21 Oct);
 * a workflow the user designed keeps its own words.
 */
export function useWorkflowWords(): { name: (t: Pick<WorkflowTemplate, 'key' | 'name'>) => string; pitch: (t: Pick<WorkflowTemplate, 'key' | 'description'>) => string } {
  const t = useT();
  return {
    name: (template) => (template.key in PITCH ? t(`workflow.name.${template.key}` as MessageKey) : template.name),
    pitch: (template) => (template.key in PITCH ? t(`workflow.pitch.${template.key}` as MessageKey) : template.description),
  };
}

export function WorkflowPicker({ templates, selectedId, onSelect, onRemove }: Props) {
  const t = useT();
  const words = useWorkflowWords();
  const locale = useLocale();
  return (
    <div role="radiogroup" aria-label={t('picker.label')} className="grid gap-3 sm:grid-cols-3">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        // Show the shape of the work, not just its name: three stages is
        // enough to tell a book workflow from a research one at a glance.
        const preview = template.stages.slice(0, 3).map((s) => stageText(locale, template.key, s, 'short') || s.short_label);

        return (
          <div key={template.id} className="relative flex">
          <button
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(template.id)}
            className={`group relative flex w-full flex-col rounded-2xl px-5 py-5 text-start transition-all duration-200 ${
              selected
                ? 'bg-[var(--surface-container-lowest)] shadow-[0_1px_2px_rgba(25,28,30,0.06),0_8px_24px_-8px_rgba(0,74,198,0.28)] ring-2 ring-[var(--pm-primary)]'
                : 'bg-[var(--surface-container-low)] hover:bg-[var(--surface-container)] hover:shadow-[0_1px_2px_rgba(25,28,30,0.04),0_6px_16px_-8px_rgba(25,28,30,0.16)]'
            }`}
          >
            <span
              aria-hidden
              className={`material-symbols-outlined mb-3 text-[24px] transition-colors ${
                selected ? 'text-[var(--pm-primary)]' : 'text-[var(--on-surface-variant)]'
              }`}
            >
              {ICON[template.key] ?? 'workspaces'}
            </span>

            <span className="text-title text-[var(--on-surface)]">
              {words.name(template)}
              {template.key.startsWith('custom_') && (
                <span className="ms-2 rounded-md bg-[var(--surface-container-high)] px-1.5 py-0.5 align-middle text-label text-[var(--on-surface-variant)]">
                  {/* Designed for this project and not saved yet (24 Oct), or one of the user's own. */}
                  {template.id.startsWith('designed:') ? t('picker.designed') : t('picker.yours')}
                </span>
              )}
            </span>

            <span className="mt-1.5 text-body text-[var(--on-surface-variant)]">
              {words.pitch(template)}
            </span>

            <span className="mt-4 flex flex-wrap items-center gap-1.5">
              {preview.map((label) => (
                <span
                  key={label}
                  className="rounded-md bg-[var(--surface-container-high)] px-1.5 py-0.5 text-label text-[var(--on-surface-variant)]"
                >
                  {label}
                </span>
              ))}
              {template.stages.length > preview.length && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  +{template.stages.length - preview.length}
                </span>
              )}
            </span>

            <span className="mt-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)] opacity-70">
              {t('picker.stages', { count: template.stages.length })}
            </span>
          </button>
          {onRemove && template.key.startsWith('custom_') && (
            <button
              type="button"
              aria-label={t('picker.remove', { name: words.name(template) })}
              title={t('picker.removeTitle')}
              onClick={() => onRemove(template)}
              className="absolute end-2 top-2 rounded-lg p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The presets taken off the list, to put back (Sean, 23 Oct: "a way to delete
 * or store them"). Nothing was deleted: projects that use them keep them.
 */
export function RemovedWorkflows({
  templates,
  onRestore,
}: {
  templates: (WorkflowTemplate & { id: string })[];
  onRestore: (template: WorkflowTemplate & { id: string }) => void;
}) {
  const t = useT();
  if (!templates.length) return null;
  return (
    <details className="mt-3 text-label text-[var(--on-surface-variant)]">
      <summary className="cursor-pointer select-none hover:text-[var(--on-surface)]">
        {t('picker.removedList', { count: templates.length })}
      </summary>
      <p className="mt-1">{t('picker.removedNote')}</p>
      <ul className="mt-2 space-y-1">
        {templates.map((template) => (
          <li key={template.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-container-low)] px-3 py-2">
            <span className="text-body text-[var(--on-surface)]">{template.name}</span>
            <button
              type="button"
              onClick={() => onRestore(template)}
              className="rounded-lg px-2 py-1 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
            >
              {t('picker.restore')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
