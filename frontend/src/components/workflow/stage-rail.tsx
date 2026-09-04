'use client';

import type {
  StageDefinition,
  StageGroup,
  StageStatus,
  WorkflowState,
  WorkflowTemplate,
} from '@/lib/workflow/types';

/**
 * The stage rail (FR-04): current stage, completed, skipped, and what is next.
 *
 * Vertical, not the horizontal strip the 5-phase flow used. Book and Research
 * have 13 stages each with per-stage status; a horizontal strip worked only
 * because there were five of them.
 */

const GROUP_LABEL: Record<StageGroup, string> = {
  planning: 'Planning',
  outlining: 'Outlining',
  drafting: 'Drafting',
  expansion: 'Expansion',
  evaluation: 'Evaluation',
  revision: 'Revision',
  final_review: 'Final review',
};

/** Material Symbols glyph per status. */
const STATUS_ICON: Record<StageStatus, string> = {
  complete: 'check_circle',
  skipped: 'do_not_disturb_on',
  in_progress: 'radio_button_checked',
  stale: 'history',
  not_started: 'radio_button_unchecked',
};

function statusColor(status: StageStatus, isCurrent: boolean): string {
  if (isCurrent) return 'text-[var(--pm-primary)]';
  switch (status) {
    case 'complete':
      return 'text-[var(--pm-secondary)]';
    case 'skipped':
      return 'text-[var(--on-surface-variant)]';
    case 'stale':
      return 'text-[var(--pm-tertiary)]';
    default:
      return 'text-[var(--on-surface-variant)]';
  }
}

interface Props {
  template: WorkflowTemplate;
  state: WorkflowState;
  nextSuggestedId: string | null;
  onSelect: (stageId: string) => void;
}

export function StageRail({ template, state, nextSuggestedId, onSelect }: Props) {
  // Group consecutive stages so the rail reads as phases rather than a flat
  // list of 13. Consecutive, not sorted: a template may legitimately revisit a
  // group later (Research returns to planning for Mechanism).
  const groups: { group: StageGroup; stages: StageDefinition[] }[] = [];
  for (const stage of template.stages) {
    const last = groups.at(-1);
    if (last && last.group === stage.group) last.stages.push(stage);
    else groups.push({ group: stage.group, stages: [stage] });
  }

  return (
    <nav aria-label="Workflow stages" className="py-2">
      {groups.map((group, gi) => (
        <div key={`${group.group}-${gi}`} className="mb-5">
          <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-[var(--on-surface-variant)]">
            {GROUP_LABEL[group.group]}
          </div>

          <ul className="space-y-0.5">
            {group.stages.map((stage) => {
              const status = state.stages[stage.id]?.status ?? 'not_started';
              const isCurrent = state.current_stage_id === stage.id;
              const isNext = !isCurrent && nextSuggestedId === stage.id;
              const skipReason = state.stages[stage.id]?.skipped_reason;

              return (
                <li key={stage.id}>
                  <button
                    onClick={() => onSelect(stage.id)}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={skipReason ? `Skipped — ${skipReason}` : stage.label}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      isCurrent
                        ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'
                        : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`material-symbols-outlined text-[18px] ${statusColor(status, isCurrent)}`}
                    >
                      {STATUS_ICON[status]}
                    </span>

                    <span
                      className={`min-w-0 flex-1 truncate ${
                        status === 'skipped' ? 'line-through opacity-70' : ''
                      }`}
                    >
                      {stage.short_label}
                    </span>

                    {/* Optional stages are marked so a user can tell what they
                        are allowed to leave out before they open it. */}
                    {!stage.required && status === 'not_started' && !isNext && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">
                        opt
                      </span>
                    )}

                    {isNext && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--pm-primary)]">
                        next
                      </span>
                    )}

                    {status === 'stale' && (
                      <span
                        title="Work here predates a change you made earlier"
                        className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        stale
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
