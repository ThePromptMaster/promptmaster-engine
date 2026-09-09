'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { StageHeader } from './stage-header';
import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar } from './stage-transition-bar';
import { StageRenderer } from './renderers/stage-renderer';
import { useStageGeneration } from './use-stage-generation';
import { useStageEvaluation } from './use-stage-evaluation';
import { StageEvaluationPanel } from './evaluation-panel';
import { ExportMenu } from './export-menu';
import { ChatPanel } from './chat-panel';
import { RecommendationsPanel } from './recommendations-panel';
import { TasksPanel } from './tasks-panel';
import { ApplyPreview } from './apply-preview';
import { useRecommendations } from './use-recommendations';
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
import { deriveOutlineItems, draftingStageId } from '@/lib/workflow/derived-outline';
import { OutlineStagePanel } from '@/components/outline/outline-stage-panel';
import { ProjectSetup, stageWantsSetup } from './project-setup';
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
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import type { StageBundle } from '@/stores/project-store';
import { approvedOutlineVersionId } from '@/lib/supabase/outline';
import type { Artifact, ArtifactVersion, Evaluation, Project, ProjectPatch } from '@/types/project';

interface Props {
  project: Project;
  artifact: Artifact | null;
  versions: ArtifactVersion[];
  template: WorkflowTemplate;
  /** Every stage's artifact and version history, keyed by stage id. */
  stages?: Record<string, StageBundle>;
  /** Stored evaluations, keyed by the version they scored. */
  evaluations?: Record<string, Evaluation>;
  onPatchProject: (patch: ProjectPatch) => void;
  appendStageVersion?: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<unknown>;
  /**
   * Attach an evaluation to a stage version that already exists (FR-11).
   *
   * Optional for the same reason `appendStageVersion` is: the preview surface
   * renders this workspace with no store behind it, and an absent writer is
   * what makes the Evaluate control absent rather than broken.
   */
  recordStageEvaluation?: (
    stageId: string,
    versionId: string,
    evaluation: NewEvaluation
  ) => Promise<Evaluation>;
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
}

export function WorkflowWorkspace({
  project,
  artifact,
  versions,
  template,
  stages: bundles,
  evaluations,
  onPatchProject,
  appendStageVersion,
  recordStageEvaluation,
  restoreStageVersion,
  setStageSummary,
  ensureStageArtifact,
  onReload,
}: Props) {
  const [events, setEvents] = useState<WorkflowEvent[] | null>(null);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  // Open by default: section 8 asks for the side chat to be part of the
  // workspace, and a panel behind a button that has to be found first is a
  // disconnected product path with an extra step.
  const [chatOpen, setChatOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

  useEffect(() => {
    listWorkflowEvents(project.id)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [project.id]);

  // State is derived from the event log in exactly one place, so it cannot
  // drift from the record.
  // `project.stage` is only consulted while the log is empty. Every project
  // imported from /session is in exactly that position — a cursor recorded by
  // the import, and no events — so without it they all open on stage one with
  // their finished output filed one click away in the rail.
  const state = useMemo(
    () => projectState(template, events ?? [], project.stage),
    [template, events, project.stage]
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
   * FR-12's fourth drift axis: the outline the work is bound to.
   *
   * Read from the long-form artifact rather than re-derived, because that is
   * the outline drafting was materialised against — an outline recomputed here
   * could disagree with the one the sections were actually written to, and
   * then the evaluation would be scoring drift against a document that never
   * existed.
   */
  const approvedOutline = useMemo(() => {
    if (approvedOutlineVersionId(events ?? []) === null) return [];
    const draftingId = draftingStageId(template);
    const holder =
      (draftingId ? stageBundles[draftingId]?.artifact : null) ??
      (stage ? stageBundles[stage.id]?.artifact : null) ??
      artifact;
    return holder?.long_form?.outline ?? [];
  }, [events, template, stageBundles, stage, artifact]);

  const stageEvaluation = useStageEvaluation({
    project,
    template,
    state,
    stage,
    bundles: stageBundles,
    approvedOutline,
    // Same guard as drafting: never spend a call on a stage the user is only
    // looking at, and never before the event log says which stage that is.
    enabled: Boolean(recordStageEvaluation) && isCurrent && events !== null,
    recordStageEvaluation,
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

  const stageVersionList = useMemo(
    () => (stage ? stageBundles[stage.id]?.versions ?? [] : []),
    [stage, stageBundles]
  );
  const headVersion = useMemo(() => stageVersionList.at(-1) ?? null, [stageVersionList]);
  const shownEvaluation = evaluations?.[activeVersionId ?? headVersion?.id ?? ''];

  const manualIds = useMemo(
    () => new Set((stage?.exit_criteria ?? []).filter((c) => c.check === 'manual').map((c) => c.id)),
    [stage]
  );

  const handleTransition = useCallback(
    async (
      option: TransitionOption,
      note?: string,
      /**
       * The accepted recommendation this move acted on (FR-02).
       *
       * Only set when the user pressed Accept on a `stage_transition`
       * recommendation. Pressing Advance on the transition bar leaves it null,
       * which is correct: nothing proposed that move, and recording a proposal
       * that did not happen would be worse than recording none.
       */
      proposalId?: string
    ) => {
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
            proposal_id: proposalId ?? null,
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

  /**
   * The recommendations surface — FR-13, FR-09, FR-01.
   *
   * Takes the pure exit-criteria `evaluation` (which is what guarantees a
   * workflow recommendation on every stage) and the stored model evaluation
   * (which supplies the contextual half where one has been paid for). Browsing
   * an earlier stage disables it for the same reason it disables generation and
   * evaluation: acting on a stage you are only looking at is never what was
   * meant.
   */
  const recommendations = useRecommendations({
    project,
    template,
    stage,
    stageEvaluation: evaluation,
    headVersion,
    storedEvaluation: shownEvaluation,
    modelRecommendation: stageEvaluation.recommendation,
    onModelRecommendationConsumed: stageEvaluation.dismissRecommendation,
    appendStageVersion,
    /**
     * Accepting a "move on to X" recommendation performs the move, and the
     * event records which proposal it acted on.
     *
     * This is the one path in the product where a model's suggestion leads to
     * a change of application state, so it is the path FR-02 is about. It uses
     * the ordinary transition machinery — same event type, same summary write,
     * same cursor patch — and adds only the citation, because a proposal-driven
     * advance is not a different kind of advance.
     */
    onAcceptTransition: async (proposalId: string) => {
      const move = transitions.find((t) => t.kind === 'advance' || t.kind === 'finish');
      if (move) await handleTransition(move, undefined, proposalId);
    },
    enabled: isCurrent && events !== null,
  });

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

  /**
   * The stage an approved outline is written *for* — the one that will draft it.
   *
   * For a derived outline this is the stage the panel already sits on, so the
   * two coincide. For Book's explicit Outline stage it is a later stage
   * entirely, and writing `long_form` onto the outline stage's own artifact
   * would leave drafting reporting "0 of 0 sections" with an approval sitting
   * in the event log saying otherwise.
   */
  const draftingStage = useMemo(() => {
    const id = draftingStageId(template);
    return id ? getStage(template, id) : null;
  }, [template]);

  const materialiseOutline = useCallback(
    async (_version: ArtifactVersion, doc: OutlineDocument) => {
      // The approved outline lives in artifact_versions; drafting reads
      // artifacts.long_form. Approving has to cross that gap, and the merge
      // keeps every section already written — approving a revised outline must
      // not cost prose that has been generated and paid for.
      const destination = draftingStage ?? stage;
      if (!destination) throw new Error('This workflow has no drafting stage.');

      const existing =
        destination.id === stage?.id ? stageArtifact : stageBundles[destination.id]?.artifact ?? null;
      const target =
        existing ??
        (ensureStageArtifact
          ? await ensureStageArtifact(destination.id, destination.label)
          : null);
      if (!target) throw new Error('This stage has no artifact to draft into.');

      await saveLongForm(target.id, longFormFromOutline(doc, target.long_form ?? null));
      onReload?.();
    },
    [draftingStage, stage, stageArtifact, stageBundles, ensureStageArtifact, onReload]
  );

  const reloadEvents = useCallback(async () => {
    setEvents(await listWorkflowEvents(project.id));
  }, [project.id]);

  if (!stage) return null;

  const stageVersions = stageVersionList;

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

  // 'explicit' is Book: a stage of its own, where the user builds the outline
  // rather than having it derived. Same panel, same approval, same
  // materialisation — it simply starts from an empty document instead of from
  // the work already done, which is why `derive` is omitted rather than stubbed.
  const explicitOutlineHere =
    template.outline_stage === 'explicit' && stage.renderer === 'outline';

  const outlinePanelHere = derivedOutlineHere || explicitOutlineHere;

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
      {/* FR-09: what is about to happen, before it happens. Opening this makes
          no model call — everything on it is computed from rows already in
          memory, and nothing is spent until Apply is pressed. */}
      {recommendations.previewing && (
        <ApplyPreview
          selected={recommendations.previewRows}
          headVersionNumber={headVersion?.version_number ?? null}
          stageLabel={stage.short_label}
          applying={recommendations.busy}
          error={recommendations.error}
          onRemove={recommendations.removeFromPreview}
          onApply={() => void recommendations.confirmApply()}
          onCancel={recommendations.closePreview}
        />
      )}

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
          <div className="mb-4 flex items-center justify-end">
            <button
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              aria-controls="stage-side-chat"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                forum
              </span>
              {chatOpen ? 'Hide side chat' : 'Side chat'}
            </button>
          </div>

          {!isCurrent && (
            <button
              onClick={() => setViewingStageId(null)}
              className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-xs text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Viewing an earlier stage — back to {getStage(template, state.current_stage_id)?.short_label}
            </button>
          )}

          {/* FR-20. Above the stage header rather than inside it: exporting is
              a property of the project, not of whichever stage happens to be
              open, and burying it in a stage would make it look like one. */}
          <div className="mb-3 flex justify-end">
            <ExportMenu
              bundle={{
                project,
                template,
                state,
                events: events ?? [],
                stages: bundles ?? {},
                evaluations: evaluations ?? {},
              }}
            />
          </div>

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
            {/* The stage's exit criteria say whether the project's setup fields
                belong here — no stage in any template asks for them twice, and
                nothing about this reads the workflow's name. */}
            {stageWantsSetup(stage) && (
              <ProjectSetup
                project={project}
                stage={stage}
                onPatch={onPatchProject}
                readOnly={!isCurrent}
              />
            )}

            {outlinePanelHere && (
              <div className="mb-6">
                <OutlineStagePanel
                  project={project}
                  stageId={stage.id}
                  events={events ?? []}
                  onEventsChanged={reloadEvents}
                  derive={derivedOutlineHere ? deriveOutline : undefined}
                  drafts={draftBindings(
                    (draftingStage && draftingStage.id !== stage.id
                      ? stageBundles[draftingStage.id]?.artifact
                      : stageArtifact
                    )?.long_form ?? null
                  )}
                  onApproved={materialiseOutline}
                  readOnly={!isCurrent}
                />
              </div>
            )}

            {/* An explicit outline stage IS the panel above — dispatching the
                renderer as well would draw the "not built yet" placeholder
                underneath a working editor. A derived outline sits on the
                drafting stage, whose renderer still has work to do, so only the
                explicit case suppresses it. */}
            {explicitOutlineHere ? null : (
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
                onEvaluate={stageEvaluation.evaluate}
                evaluating={stageEvaluation.evaluating}
                evaluationError={stageEvaluation.error}
                generationFailure={generation.failure}
                evaluationFailure={stageEvaluation.failure}
                onDismissFailure={() => {
                  generation.dismissFailure();
                  stageEvaluation.dismissFailure();
                }}
                onSwitchModel={(model) => onPatchProject({ model })}
                currentModel={project.model}
                readOnly={!isCurrent}
                evaluation={
                  evaluations?.[
                    activeVersionId ?? stageVersions.at(-1)?.id ?? ''
                  ]
                }
                longForm={longFormContext}
              />
            )}
          </div>

          <div className="space-y-4">
            {/* The order below is the argument. The checklist states the gap;
                the recommendations propose closing it; the evaluation is the
                evidence some of them rest on, so it sits under the thing it
                justifies rather than above it. Tasks are what was set aside,
                and the transition bar is the way out. */}
            <ExitCriteriaChecklist
              criteria={evaluation.criteria}
              manualIds={manualIds}
              onToggleManual={handleToggleManual}
            />

            <RecommendationsPanel
              stageLabel={stage.short_label}
              rows={recommendations.rows}
              selected={recommendations.selected}
              onToggleSelect={recommendations.toggleSelect}
              onTriage={(rec, status, reason) => void recommendations.triage(rec, status, reason)}
              onApply={recommendations.openPreview}
              busy={recommendations.busy}
              readOnly={!isCurrent}
            />

            {/* Beside the exit criteria rather than under the artifact: both
                answer "is this good enough to move on", and the criteria are
                the declarative half of the same question the evaluation
                answers by judgment. */}
            <StageEvaluationPanel evaluation={shownEvaluation} />

            <TasksPanel
              tasks={recommendations.tasks}
              onResolve={(id, status) => void recommendations.resolveTask(id, status)}
              busy={recommendations.busy}
              readOnly={!isCurrent}
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

      {/* The side chat, in the workspace rather than on a route of its own —
          section 8 asks for artifact, evaluation, versions and chat to sit
          together. It reads the version currently on screen, so a question
          asked while browsing an old version is a question about that version.

          One mount, two positions: a rail beside the work on a wide screen, a
          sheet over it on a narrow one. Mounting it twice would give the stage
          two threads and two histories of the same conversation. */}
      {chatOpen && (
        <aside
          id="stage-side-chat"
          className="fixed inset-0 z-40 bg-[var(--surface)] p-4 lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-screen lg:w-[380px] lg:shrink-0 lg:bg-transparent lg:py-6 lg:pl-0 lg:pr-6"
        >
          <button
            onClick={() => setChatOpen(false)}
            className="mb-2 ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-label text-[var(--on-surface-variant)] lg:hidden"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">
              close
            </span>
            Close
          </button>

          <div className="h-[calc(100%-2rem)] lg:h-full">
            <ChatPanel
              project={project}
              stageId={stage.id}
              stageLabel={stage.label}
              content={
                (activeVersionId
                  ? stageVersions.find((v) => v.id === activeVersionId)?.content
                  : undefined) ??
                stageVersions.at(-1)?.content ??
                ''
              }
              headVersion={stageVersions.at(-1) ?? null}
              appendStageVersion={appendStageVersion}
              restoreStageVersion={restoreStageVersion}
              readOnly={!isCurrent}
              // Revising splices into the content it was handed, so instructing
              // while reading an older version would append a version built
              // from it and lose everything since. Discussion is unaffected.
              canInstruct={
                activeVersionId === null || activeVersionId === stageVersions.at(-1)?.id
              }
            />
          </div>
        </aside>
      )}
    </div>
  );
}
