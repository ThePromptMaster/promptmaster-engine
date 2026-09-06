'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { StageHeader } from './stage-header';
import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar } from './stage-transition-bar';
import { StageRenderer } from './renderers/stage-renderer';
import { useStageGeneration } from './use-stage-generation';
import {
  availableTransitions,
  evaluateStage,
  getStage,
  nextSuggestedStage,
  progressSummary,
  projectState,
  type TransitionOption,
} from '@/lib/workflow/engine';
import { summariseStageContent } from '@/lib/workflow/digest';
import { deriveOutlineItems } from '@/lib/workflow/derived-outline';
import { OutlineStagePanel } from '@/components/outline/outline-stage-panel';
import { draftBindings, longFormFromOutline } from '@/lib/outline/long-form';
import { saveLongForm } from '@/lib/supabase/versions';
import type { OutlineDocument } from '@/types/outline';
import {
  isTriaged,
  itemSchemaFor,
  parseItems,
  rendererHoldsItems,
  serializeItems,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import { appendWorkflowEvent, listWorkflowEvents } from '@/lib/supabase/workflow';
import type { NewVersion } from '@/lib/supabase/versions';
import type { StageBundle } from '@/stores/project-store';
import { approvedOutlineVersionId } from '@/lib/supabase/outline';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';

interface Props {
  project: Project;
  artifact: Artifact | null;
  versions: ArtifactVersion[];
  template: WorkflowTemplate;
  /** Every stage's artifact and version history, keyed by stage id. */
  stages?: Record<string, StageBundle>;
  onPatchProject: (patch: { manual_checks?: Record<string, boolean>; stage?: string }) => void;
  appendStageVersion?: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<unknown>;
  restoreStageVersion?: (stageId: string, versionId: string) => Promise<void>;
  setStageSummary?: (stageId: string, summary: string) => Promise<void>;
  /**
   * Create a stage's artifact if it has none yet.
   *
   * A drafting stage generates nothing on entry, so nothing had ever created
   * its row — and approving an outline with nowhere to write it would leave
   * drafting reporting "0 of 0 sections" with an approval in the log saying
   * otherwise.
   */
  ensureStageArtifact?: (stageId: string, name: string) => Promise<Artifact>;
  /** Reload project state after the server changed it behind our back. */
  onReload?: () => void;
  /** Rendered instead of the dispatched renderer; used by the legacy pane. */
  children?: React.ReactNode;
}

export function WorkflowWorkspace({
  project,
  artifact,
  versions,
  template,
  stages: bundles,
  onPatchProject,
  appendStageVersion,
  restoreStageVersion,
  setStageSummary,
  ensureStageArtifact,
  onReload,
  children,
}: Props) {
  const [events, setEvents] = useState<WorkflowEvent[] | null>(null);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

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

  const stageBundles = useMemo(() => bundles ?? {}, [bundles]);

  // Viewing resets per stage: a version pill selected on one stage means
  // nothing on the next.
  useEffect(() => setActiveVersionId(null), [stageId]);

  const generation = useStageGeneration({
    project,
    template,
    state,
    stage,
    bundles: stageBundles,
    // Never start work on a stage the user is only looking at, and never
    // before the event log has loaded — the current stage is not yet known.
    enabled: Boolean(appendStageVersion) && isCurrent && events !== null,
    appendStageVersion: appendStageVersion ?? (async () => undefined),
  });

  /**
   * The exit-criteria context.
   *
   * These fields were hardcoded to {} and 0, which meant every `min_items` and
   * `every_item_has_status` criterion in both templates evaluated false and
   * could never be satisfied — the checklist was decorative. Deriving them from
   * the stage artifacts is what makes the gates real.
   */
  const context: StageContext = useMemo(() => {
    // The drafting stage has its own artifact in a thirteen-stage Book; only a
    // single-output project keeps everything on the project-level one. Reading
    // the project artifact unconditionally made sectionsComplete permanently 0
    // for Book, so all_sections_complete could never satisfy.
    const longFormArtifact =
      (stage ? stageBundles[stage.id]?.artifact : null) ?? artifact;
    const longForm = longFormArtifact?.long_form ?? null;
    const outline = longForm?.outline ?? [];

    const itemCounts: Record<string, number> = {};
    const itemsMissingStatus: Record<string, number> = {};
    const artifactNonEmpty: Record<string, boolean> = {};
    let findingsTotal = 0;
    let findingsTriaged = 0;

    for (const s of template.stages) {
      const bundle = stageBundles[s.id];
      const content = bundle?.versions.at(-1)?.content ?? '';
      artifactNonEmpty[s.id] = content.trim().length > 0;

      if (!rendererHoldsItems(s.renderer)) continue;
      const items = parseItems(content);
      if (!items) continue;

      const schema = itemSchemaFor(s);
      itemCounts[s.id] = items.length;
      itemsMissingStatus[s.id] = items.filter((i) => !isTriaged(i, schema)).length;

      // Findings criteria are about the stage being looked at, not the whole
      // project: "3 untriaged" on the Critique stage must not count Continuity's.
      if (s.id === stageId && s.renderer === 'review') {
        findingsTotal = items.length;
        findingsTriaged = items.length - itemsMissingStatus[s.id];
      }
    }

    // The single-output project keeps its one artifact, which has no stage row.
    if (stage && !stageBundles[stage.id]) {
      artifactNonEmpty[stage.id] =
        versions.length > 0 && versions.at(-1)!.content.trim().length > 0;
    }

    return {
      fields: {
        objective: project.objective,
        audience: project.audience,
        constraints: project.constraints,
      },
      itemCounts,
      itemsMissingStatus,
      artifactNonEmpty,
      // Approval is an event, not a mode the long-form machine happens to be
      // in. Reading it from long_form.state was a placeholder that could only
      // ever be true once drafting had already started — which is backwards,
      // since drafting is what approval gates.
      outlineApproved: approvedOutlineVersionId(events ?? []) !== null,
      sectionsTotal: outline.length,
      sectionsComplete: outline.filter((s) => s.status === 'complete').length,
      findingsTotal,
      findingsTriaged,
      manualChecks: project.manual_checks ?? {},
    };
  }, [project, artifact, versions, stage, stageId, template, stageBundles, events]);

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

        // Record what this stage concluded before leaving it. Later stages
        // generate against this summary, so writing it at completion — rather
        // than recomputing at every call — means a subsequent edit upstream
        // cannot silently rewrite the context a downstream draft was given.
        if (type === 'stage_completed' && setStageSummary) {
          const content = stageBundles[stage.id]?.versions.at(-1)?.content ?? '';
          const summary = summariseStageContent(stage, content);
          if (summary) await setStageSummary(stage.id, summary).catch(() => {});
        }

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
    [stage, busy, events, project, template, onPatchProject, setStageSummary, stageBundles]
  );

  const handleToggleManual = useCallback(
    (id: string, checked: boolean) => {
      onPatchProject({
        manual_checks: { ...(project.manual_checks ?? {}), [id]: checked },
      });
    },
    [project.manual_checks, onPatchProject]
  );

  const saveContent = useCallback(
    async (content: string) => {
      if (!stage || !appendStageVersion) return;
      await appendStageVersion(stage.id, stage.label, {
        content,
        source_operation: 'stage_edit',
        model: project.model,
        mode: project.mode,
        change_summary: 'Edited by hand.',
      });
    },
    [stage, appendStageVersion, project.model, project.mode]
  );

  const saveItems = useCallback(
    async (items: StageItem[]) => {
      await saveContent(serializeItems(items));
    },
    [saveContent]
  );

  const restore = useCallback(
    async (versionId: string) => {
      if (!stage || !restoreStageVersion) return;
      await restoreStageVersion(stage.id, versionId);
      setActiveVersionId(null);
    },
    [stage, restoreStageVersion]
  );

  /**
   * The artifact this stage writes into.
   *
   * The project-level `artifact` is only a legitimate answer for a project whose
   * one artifact has no stage at all — the single-output shape. A thirteen-stage
   * project's `artifact` is whichever row happened to sort first, so falling
   * back to it on a stage that has no artifact yet would materialise a drafting
   * outline onto the research question's row.
   */
  const stageArtifact =
    (stage ? stageBundles[stage.id]?.artifact : null) ??
    (artifact && !artifact.stage_id ? artifact : null);

  const deriveOutline = useCallback(
    () => deriveOutlineItems(template, state, stageBundles),
    [template, state, stageBundles]
  );

  const materialiseOutline = useCallback(
    async (_version: ArtifactVersion, doc: OutlineDocument) => {
      // The approved outline lives in artifact_versions; drafting reads
      // artifacts.long_form. Approving has to cross that gap, and the merge
      // keeps every section already written — approving a revised outline must
      // not cost prose that has been generated and paid for.
      const target =
        stageArtifact ??
        (stage && ensureStageArtifact ? await ensureStageArtifact(stage.id, stage.label) : null);
      if (!target) throw new Error('This stage has no artifact to draft into.');

      await saveLongForm(target.id, longFormFromOutline(doc, target.long_form ?? null));
      onReload?.();
    },
    [stageArtifact, stage, ensureStageArtifact, onReload]
  );

  const reloadEvents = useCallback(async () => {
    setEvents(await listWorkflowEvents(project.id));
  }, [project.id]);

  if (!stage) return null;

  const stageVersions = stageBundles[stage.id]?.versions ?? [];

  /**
   * The derived outline (FR-07), routed on `outline_stage` rather than on the
   * template key.
   *
   * 'explicit' is Book: a stage of its own where the user builds and approves
   * an outline. 'derived' has no such stage — the outline falls out of the work
   * already done, so it is offered on the drafting stage itself, above the
   * drafting renderer. 'none' is single_output, which has no outline at all.
   *
   * Nothing below this point knows the difference. The derivation produces an
   * ordinary outline document, the user edits it in the ordinary editor, and
   * approving it writes the ordinary `outline_approved` event that drafting
   * binds to — which is why the drafting renderer needed no change and still
   * cannot tell one workflow from another.
   */
  const derivedOutlineHere =
    template.outline_stage === 'derived' && template.derived_outline?.stage_id === stage.id;

  // Only assembled for drafting stages. Carries the project row because the
  // drain will rebuild this project's PMInput hours from now, in a process that
  // has never seen the user.
  const longFormContext =
    stage.renderer === 'long_form'
      ? {
          project,
          artifactId: stageArtifact?.id ?? null,
          stageId: stage.id,
          state: stageArtifact?.long_form ?? null,
          approvedOutlineVersionId: approvedOutlineVersionId(events ?? []),
          onRefresh: () => onReload?.(),
        }
      : undefined;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 overflow-y-auto bg-[var(--surface-container-lowest)] px-2 py-6 md:block sidebar-scroll">
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

          <div className="mb-8">
            {derivedOutlineHere && !children && (
              <div className="mb-6">
                <OutlineStagePanel
                  project={project}
                  stageId={stage.id}
                  events={events ?? []}
                  onEventsChanged={reloadEvents}
                  derive={deriveOutline}
                  drafts={draftBindings(stageArtifact?.long_form ?? null)}
                  onApproved={materialiseOutline}
                  readOnly={!isCurrent}
                />
              </div>
            )}

            {/* `children` is the legacy single-output pane. Once that workflow
                renders through `single_output`, this prop goes. */}
            {children ?? (
              <StageRenderer
                stage={stage}
                schema={itemSchemaFor(stage)}
                versions={stageVersions}
                activeVersionId={activeVersionId}
                onSelectVersion={setActiveVersionId}
                onRestore={restore}
                onSaveContent={appendStageVersion ? saveContent : undefined}
                onSaveItems={appendStageVersion ? saveItems : undefined}
                generating={generation.generating}
                generationError={generation.error}
                onGenerate={generation.generate}
                onCancelGeneration={generation.cancel}
                readOnly={!isCurrent}
                longForm={longFormContext}
              />
            )}
          </div>

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
