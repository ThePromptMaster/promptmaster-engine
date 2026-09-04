'use client';

import type { WorkflowTemplate } from '@/lib/workflow/types';

const ICON: Record<string, string> = {
  book: 'menu_book',
  research: 'science',
  single_output: 'bolt',
};

/**
 * A one-line promise per workflow. The template's own description is written
 * for the stage list; this is written for someone deciding.
 */
const PITCH: Record<string, string> = {
  book: 'Long-form writing that has to hold together across chapters.',
  research: 'An investigation where the method matters as much as the result.',
  single_output: 'One thing, done well. No stages to work through.',
};

interface Props {
  templates: (WorkflowTemplate & { id: string })[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function WorkflowPicker({ templates, selectedId, onSelect }: Props) {
  return (
    <div role="radiogroup" aria-label="Workflow" className="grid gap-3 sm:grid-cols-3">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        // Show the shape of the work, not just its name: three stages is
        // enough to tell a book workflow from a research one at a glance.
        const preview = template.stages.slice(0, 3).map((s) => s.short_label);

        return (
          <button
            key={template.id}
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(template.id)}
            className={`group relative flex flex-col rounded-2xl px-5 py-5 text-left transition-all duration-200 ${
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

            <span className="text-title text-[var(--on-surface)]">{template.name}</span>

            <span className="mt-1.5 text-body text-[var(--on-surface-variant)]">
              {PITCH[template.key] ?? template.description}
            </span>

            <span className="mt-4 flex flex-wrap items-center gap-1.5">
              {preview.map((label) => (
                <span
                  key={label}
                  className="rounded-md bg-[var(--surface-container-high)] px-1.5 py-0.5 text-[11px] text-[var(--on-surface-variant)]"
                >
                  {label}
                </span>
              ))}
              {template.stages.length > preview.length && (
                <span className="text-[11px] text-[var(--on-surface-variant)]">
                  +{template.stages.length - preview.length}
                </span>
              )}
            </span>

            <span className="mt-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)] opacity-70">
              {template.stages.length} stage{template.stages.length === 1 ? '' : 's'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
