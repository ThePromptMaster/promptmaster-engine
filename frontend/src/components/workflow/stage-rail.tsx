'use client';

import { isDone } from '@/lib/workflow/types';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { shownCheckText } from '@/lib/i18n/check-text';
import { groupLabel, stageText } from '@/lib/i18n/templates';
import type { MessageKey } from '@/lib/i18n/messages/en';
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
  /**
   * The finished last stage, while the project's objective is not met: it is
   * drawn as waiting, not ticked (13 Oct, Sean, workshop: "Summary appeared
   * completed while the project remained open").
   */
  projectOpenOn?: string | null;
  /**
   * Per stage, findings still open (`openFindingsByStage`): a finished stage
   * with any is drawn "done · N open", not a plain tick (18 Oct, Sean, Summit).
   */
  openFindings?: Readonly<Record<string, number>>;
}

export function StageRail({ template, state, nextSuggestedId, onSelect, approvalPendingIds, projectOpenOn, openFindings }: Props) {
  // Group consecutive stages so the rail reads as phases rather than a flat
  // list of 13. Consecutive, not sorted: a template may legitimately revisit a
  // group later (Research returns to planning for Mechanism).
  const t = useT();
  const locale = useLocale();
  const groups: { group: StageGroup; stages: StageDefinition[] }[] = [];
  for (const stage of template.stages) {
    const last = groups.at(-1);
    if (last && last.group === stage.group) last.stages.push(stage);
    else groups.push({ group: stage.group, stages: [stage] });
  }

  return (
    <nav aria-label={t('rail.label')} className="py-2">
      {groups.map((group, gi) => (
        <div key={`${group.group}-${gi}`} className="mb-3 last:mb-0">
          <div className="mb-1 px-3 text-label uppercase tracking-[0.08em] text-[var(--on-surface-variant)] opacity-70">
            {groupLabel(locale, group.group, GROUP_LABEL[group.group])}
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
              const projectOpen = projectOpenOn === stage.id;
              const openCount = isDone(status) && !projectOpen ? openFindings?.[stage.id] ?? 0 : 0;

              return (
                <li key={stage.id}>
                  <button
                    onClick={() => onSelect(stage.id)}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={skipReason ? t('rail.skippedTitle', { reason: skipReason }) : stageText(locale, template.key, stage, 'label')}
                    // Wraps: two badges (NEXT and AWAITING RECHECK) used to squeeze the
                    // stage's name to nothing (25 Oct, Sean's iPad: "Lan… NEXT REOPENED").
                    className={`flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-lg px-3 py-2 text-start text-body transition-colors ${
                      isCurrent
                        ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'
                        : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`material-symbols-outlined text-[18px] ${openElsewhere || projectOpen || (openCount && !isCurrent) ? 'text-[var(--pm-tertiary)]' : statusColor(status, isCurrent)}`}
                    >
                      {projectOpen ? 'pending_actions' : openElsewhere ? OPEN_ELSEWHERE_ICON : STATUS_ICON[status]}
                    </span>

                    <span
                      className={`min-w-[5.5rem] flex-1 truncate ${
                        status === 'skipped' ? 'line-through opacity-70' : ''
                      }`}
                    >
                      {stageText(locale, template.key, stage, 'short')}
                    </span>

                    {/* Optional stages are marked so a user can tell what they
                        are allowed to leave out before they open it. */}
                    {!stage.required && status === 'not_started' && !isNext && (
                      <span className="shrink-0 text-label uppercase tracking-wide opacity-60">
                        {t('rail.optional')}
                      </span>
                    )}

                    {isNext && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-label uppercase tracking-wide text-[var(--pm-primary)]">
                        {t('rail.next')}
                      </span>
                    )}

                    {/* PM-13: moved past, not finished. */}
                    {leftOpen && (
                      <span
                        title={`${t('rail.leftOpenWhy')}${awaitingApproval ? t('rail.leftOpenApproval') : ''}${
                          state.stages[stage.id]?.left_reason ? t('rail.leftOpenReason', { reason: state.stages[stage.id]!.left_reason! }) : ''
                        }`}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.leftOpen')}
                      </span>
                    )}
                    {awaitingApproval && isCurrent && (
                      <span
                        title={t('rail.yourApprovalWhy')}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.yourApproval')}
                      </span>
                    )}
                    {openElsewhere && !leftOpen && (
                      <span
                        title={t('rail.reopenedWhy')}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.reopened')}
                      </span>
                    )}

                    {openCount > 0 && (
                      <span
                        title={t('rail.doneOpenWhy', { count: openCount })}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.doneOpen', { count: openCount })}
                      </span>
                    )}

                    {projectOpen && (
                      <span
                        title={t('rail.waitingWhy')}
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.waiting')}
                      </span>
                    )}

                    {status === 'stale' && (
                      <span
                        title={
                          state.stages[stage.id]?.stale?.reason
                            ? t('rail.recheckWhy', { reason: shownCheckText(locale, state.stages[stage.id]!.stale!.reason, template.key, template.stages) })
                            : t('rail.recheckEarlier')
                        }
                        className="shrink-0 text-label uppercase tracking-wide text-[var(--pm-tertiary)]"
                      >
                        {t('rail.recheck')}
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
          {t('rail.legend')}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {LEGEND.map(([icon, words]) => (
            <li key={icon} className="flex items-center gap-2">
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                {icon}
              </span>
              {t(words)}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

const LEGEND: [string, MessageKey][] = [
  [STATUS_ICON.completed_with_artifact, 'rail.legend.saved'],
  [STATUS_ICON.complete, 'rail.legend.done'],
  [STATUS_ICON.in_progress, 'rail.legend.here'],
  [OPEN_ELSEWHERE_ICON, 'rail.legend.open'],
  [STATUS_ICON.not_started, 'rail.legend.notStarted'],
  [STATUS_ICON.skipped, 'rail.legend.skipped'],
  [STATUS_ICON.blocked, 'rail.legend.blocked'],
  [STATUS_ICON.stale, 'rail.legend.stale'],
];
