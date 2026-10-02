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
  completed_with_artifact: 'task_alt',
  blocked: 'block',
  skipped: 'do_not_disturb_on',
  in_progress: 'radio_button_checked',
  stale: 'history',
  not_started: 'radio_button_unchecked',
};

/** Open but not where the project is: left open, or reopened to edit. */
const OPEN_ELSEWHERE_ICON = 'pending';

function statusColor(status: StageStatus, isCurrent: boolean): string {
  if (isCurrent) return 'text-[var(--pm-primary)]';
  switch (status) {
    case 'complete':
    case 'completed_with_artifact':
      return 'text-[var(--pm-secondary)]';
    case 'blocked':
      return 'text-[var(--pm-tertiary)]';
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
  /** Open stages where the only required thing left is the user's approval. */
  approvalPendingIds?: ReadonlySet<string>;
}

export function StageRail({ template, state, nextSuggestedId, onSelect, approvalPendingIds }: Props) {
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
        <div key={`${group.group}-${gi}`} className="mb-3 last:mb-0">
          <div className="mb-1 px-3 text-label uppercase tracking-[0.08em] text-[var(--on-surface-variant)] opacity-70">
            {GROUP_LABEL[group.group]}
          </div>

          <ul className="space-y-0.5">
            {group.stages.map((stage) => {
              const status = state.stages[stage.id]?.status ?? 'not_started';
              const isCurrent = state.current_stage_id === stage.id;
              const isNext = !isCurrent && nextSuggestedId === stage.id;
              const skipReason = state.stages[stage.id]?.skipped_reason;
              // A stage moved past with something required still open, or one
              // reopened to edit, used the "You are here" glyph: two stages
              // looked current at once (1 Oct, item 1).
              const openElsewhere = status === 'in_progress' && !isCurrent;
              const leftOpen = openElsewhere && Boolean(state.stages[stage.id]?.left_open);
              const awaitingApproval = status === 'in_progress' && Boolean(approvalPendingIds?.has(stage.id));

              return (
                <li key={stage.id}>
                  <button
                    onClick={() => onSelect(stage.id)}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={skipReason ? `Skipped — ${skipReason}` : stage.label}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body transition-colors ${
                      isCurrent
                        ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'
                        : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`material-symbols-outlined text-[18px] ${openElsewhere ? 'text-[var(--pm-tertiary)]' : statusColor(status, isCurrent)}`}
                    >
                      {openElsewhere ? OPEN_ELSEWHERE_ICON : STATUS_ICON[status]}
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
                      <span className="shrink-0 text-label uppercase tracking-wide opacity-60">
                        optional
                      </span>
                    )}

                    {isNext && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-label uppercase tracking-wide text-[var(--pm-primary)]">
                        next
                      </span>
                    )}

                    {/* PM-13: moved past, not finished. */}
                    {leftOpen && (
                      <span
                        title={`You moved on with something required still open — this stage is not complete.${
                          awaitingApproval ? ' The only thing it is waiting for is your approval.' : ''
                        }${
                          state.stages[stage.id]?.left_reason ? ` Your reason: ${state.stages[stage.id]!.left_reason}` : ''
                        }`}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        left open
                      </span>
                    )}
                    {awaitingApproval && isCurrent && (
                      <span
                        title="PromptMaster has verified what it can — this stage is waiting for your approval"
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        your approval
                      </span>
                    )}
                    {openElsewhere && !leftOpen && (
                      <span
                        title="Reopened to edit — mark it complete again when you are done"
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        reopened
                      </span>
                    )}

                    {status === 'stale' && (
                      <span
                        title="Work here predates a change you made earlier"
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        recheck
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* PM-07: the glyphs, in words. */}
      <details className="mt-4 px-3 text-label text-[var(--on-surface-variant)]">
        <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">
          What the icons mean
        </summary>
        <ul className="mt-2 space-y-1.5">
          {LEGEND.map(([icon, words]) => (
            <li key={icon} className="flex items-center gap-2">
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                {icon}
              </span>
              {words}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

const LEGEND: [string, string][] = [
  [STATUS_ICON.completed_with_artifact, 'Done, with its work saved'],
  [STATUS_ICON.complete, 'Done'],
  [STATUS_ICON.in_progress, 'You are here'],
  [OPEN_ELSEWHERE_ICON, 'Left open or reopened — something required is still pending'],
  [STATUS_ICON.not_started, 'Not started yet'],
  [STATUS_ICON.skipped, 'Skipped on purpose, with a reason'],
  [STATUS_ICON.blocked, 'Stuck — waiting on something'],
  [STATUS_ICON.stale, 'Recheck — something before it changed'],
];
