'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { StageHeader } from './stage-header';
import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar } from './stage-transition-bar';
import {
  availableTransitions,
  evaluateStage,
  getStage,
  nextSuggestedStage,
  progressSummary,
  projectState,
  type TransitionOption,
} from '@/lib/workflow/engine';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import { appendWorkflowEvent, listWorkflowEvents } from '@/lib/supabase/workflow';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';

interface Props {
  project: Project;
  artifact: Artifact | null;
  versions: ArtifactVersion[];
  template: WorkflowTemplate;
  onPatchProject: (patch: { manual_checks?: Record<string, boolean>; stage?: string }) => void;
  children?: React.ReactNode;
}

export function WorkflowWorkspace({
  project,
  artifact,
  versions,
  template,
  onPatchProject,
  children,
}: Props) {
  const [events, setEvents] = useState<WorkflowEvent[] | null>(null);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listWorkflowEvents(project.id)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [project.id]);

  // State is derived from the event log in exactly one place, so it cannot
  // drift from the record.
  const state = useMemo(
    () => projectState(template, events ?? []),
    [template, events]
  );

  // What the rail highlights vs what the user is reading: selecting a stage
  // browses it without moving the workflow cursor.
  const stageId = viewingStageId ?? state.current_stage_id;
  const stage = getStage(template, stageId);
  const isCurrent = stageId === state.current_stage_id;

  const context: StageContext = useMemo(() => {
    const longForm = artifact?.long_form ?? null;
    const outline = longForm?.outline ?? [];
    return {
      fields: {
        objective: project.objective,
        audience: project.audience,
        constraints: project.constraints,
      },
      itemCounts: {},
      itemsMissingStatus: {},
      artifactNonEmpty: stage
        ? { [stage.id]: versions.length > 0 && versions.at(-1)!.content.trim().length > 0 }
        : {},
      outlineApproved: longForm?.state === 'writing' || longForm?.state === 'complete',
      sectionsTotal: outline.length,
      sectionsComplete: outline.filter((s) => s.status === 'complete').length,
      findingsTotal: 0,
      findingsTriaged: 0,
      manualChecks: project.manual_checks ?? {},
    };
  }, [project, artifact, versions, stage]);

  const evaluation = useMemo(
    () => evaluateStage(template, stageId, context),
    [template, stageId, context]
  );

  const nextSuggested = useMemo(
    () => nextSuggestedStage(template, state),
    [template, state]
  );

  const transitions = useMemo(
    () => availableTransitions(template, state, evaluation),
    [template, state, evaluation]
  );

  const progress = useMemo(() => progressSummary(template, state), [template, state]);

  const manualIds = useMemo(
    () => new Set((stage?.exit_criteria ?? []).filter((c) => c.check === 'manual').map((c) => c.id)),
    [stage]
  );

  const handleTransition = useCallback(
    async (option: TransitionOption, note?: string) => {
      if (!stage || busy) return;
      setBusy(true);
      try {
        const type =
          option.kind === 'skip'
            ? 'stage_skipped'
            : option.kind === 'return'
              ? 'stage_returned'
              : 'stage_completed';

        const nextSeq = (events?.length ?? 0) + 1;
        await appendWorkflowEvent(
          project.id,
          project.user_id,
          {
            type,
            stage_id: stage.id,
            to_stage_id: option.toStageId ?? undefined,
            reason: note,
          },
          nextSeq
        );

        const fresh = await listWorkflowEvents(project.id);
        setEvents(fresh);
        setViewingStageId(null);

        // projects.stage is a denormalised cursor for the list view; the event
        // log stays the record.
        const moved = projectState(template, fresh).current_stage_id;
        if (moved !== project.stage) onPatchProject({ stage: moved });
      } finally {
        setBusy(false);
      }
    },
    [stage, busy, events, project, template, onPatchProject]
  );

  const handleToggleManual = useCallback(
    (id: string, checked: boolean) => {
      onPatchProject({
        manual_checks: { ...(project.manual_checks ?? {}), [id]: checked },
      });
    },
    [project.manual_checks, onPatchProject]
  );

  if (!stage) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[248px] shrink-0 bg-[var(--surface-container-lowest)] px-2 py-6 md:block">
        <div className="mb-4 px-3">
          <div className="text-xs uppercase tracking-wider text-[var(--on-surface-variant)]">
            {template.name}
          </div>
          <div className="mt-1 text-xs text-[var(--on-surface-variant)]">
            {progress.complete} done
            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
            {` · ${progress.remaining} to go`}
          </div>
        </div>

        <StageRail
          template={template}
          state={state}
          nextSuggestedId={nextSuggested}
          onSelect={setViewingStageId}
        />
      </aside>

      <main className="min-w-0 flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-[820px]">
          {!isCurrent && (
            <button
              onClick={() => setViewingStageId(null)}
              className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-xs text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Viewing an earlier stage — back to {getStage(template, state.current_stage_id)?.short_label}
            </button>
          )}

          <StageHeader
            stage={stage}
            status={state.stages[stage.id]?.status ?? 'not_started'}
            skippedReason={state.stages[stage.id]?.skipped_reason}
            position={{
              index: template.stages.findIndex((s) => s.id === stage.id) + 1,
              total: template.stages.length,
            }}
          />

          <div className="mb-8">{children}</div>

          <div className="space-y-4">
            <ExitCriteriaChecklist
              criteria={evaluation.criteria}
              manualIds={manualIds}
              onToggleManual={handleToggleManual}
            />

            {/* Transitions act on the current stage only — browsing history
                must not let you advance a stage you are merely looking at. */}
            {isCurrent && (
              <StageTransitionBar
                stage={stage}
                evaluation={evaluation}
                options={transitions}
                onTransition={handleTransition}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
