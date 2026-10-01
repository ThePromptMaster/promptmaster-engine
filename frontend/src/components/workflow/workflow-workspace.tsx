'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StageHeader } from './stage-header';
import { StageRail } from './stage-rail';
import { ExitCriteriaChecklist } from './exit-criteria-checklist';
import { StageTransitionBar, type MoreAction } from './stage-transition-bar';
import { ConfirmOverwrite } from './renderers/stage-chrome';
import { CheckpointPanel } from './checkpoint-panel';
import { UpgradeBanner } from './upgrade-banner';
import { templateDiff } from '@/lib/workflow/upgrade';
import { BlockForm, BlockedNotice, CompletionDialog } from './stage-status-panels';
import { StageToolResult } from './stage-tool-result';
import { CRITIQUE_TOOLS, REWRITE_TOOLS, useStageTools } from './use-stage-tools';
import { nextStageAction, type ReportedPanelStep } from '@/lib/workflow/next-action';
import { isApplyable } from '@/lib/workflow/recommend';
import { ProjectFinished } from './project-finished';
import { ProjectFinishedBanner } from './project-finished-banner';
import { StageRenderer } from './renderers/stage-renderer';
import { useStageGeneration } from './use-stage-generation';
import { useStageEvaluation } from './use-stage-evaluation';
import { useGoLoop } from './use-go-loop';
import { GoPanel } from './agent/go-panel';
import { NextMoveCard } from './next-move-card';
import { StageEvaluationPanel } from './evaluation-panel';
import { CritiqueStyleControl } from './critique-style-control';
import { CritiqueActions } from './critique-actions';
import { RevisedPreview } from './revised-preview';
import { useApplyFindings } from './use-apply-findings';
import { generationRequest } from '@/lib/workflow/stage-requests';
import { findingFromPoint, pointsFromCommentary } from '@/lib/workflow/critique-points';
import { ExportMenu } from './export-menu';
import { FullDocumentReader } from './full-document-reader';
import { listWorkflowEvents } from '@/lib/supabase/workflow';
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
  completionSummary,
  deliverableStage,
  tickClosesStage,
} from '@/lib/workflow/engine';
import { buildStageDigest, formatManuscript, summariseStageContent } from '@/lib/workflow/digest';
import { keepFinishedVersion, stageContentForSummary, stageEvidence } from '@/lib/workflow/evidence';
import { api } from '@/lib/api/client';
import { inputsFrom } from './use-stage-generation';
import type { EvaluationResult } from '@/types';
import { revisionBrief } from '@/lib/workflow/revision';
import { defaultOutlineForm, deriveOutlineItems, draftingStageId, formOfItems, outlineForms } from '@/lib/workflow/derived-outline';
import { OutlineStagePanel } from '@/components/outline/outline-stage-panel';
import { ProjectBrief, ProjectSetup, stageWantsSetup } from './project-setup';
import { ProjectData } from './project-data';
import { draftBindings } from '@/lib/outline/long-form';
import { approveOutline, loadOutline, materialiseOutlineInto } from '@/lib/outline/actions';
import type { OutlineDocument } from '@/types/outline';
import { stageDrafts, itemSchemaFor, parseItems, rendererHoldsItems, serializeItems, stageContentForChat, type StageItem } from '@/lib/workflow/stage-artifact';
import { previewRowAction } from '@/lib/workflow/row-actions';
import { applyLookup, lookupSummary } from '@/lib/workflow/lookup';
import { readStageFigures, type StageFigures } from '@/lib/workflow/figures';
import { FiguresOnRecord } from './figures-on-record';
import type { ReplyAction } from '@/types';
import { buildStageContext } from '@/lib/workflow/context';
import type { StageContext, WorkflowTemplate, BlockKind } from '@/lib/workflow/types';
import { isDone } from '@/lib/workflow/types';
import { getLatestTemplate } from '@/lib/supabase/workflow';
import { setUsageProject } from '@/lib/supabase/model-usage';
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import { useProjectStore, type StageBundle } from '@/stores/project-store';
import { commitOutlineVersion, approvedOutlineVersionId } from '@/lib/supabase/outline';
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
  setStageFigures?: (stageId: string, figures: StageFigures) => Promise<void>;
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

/** Per-viewer convenience only: whether this person last left the side chat open. */
const CHAT_OPEN_KEY = 'pm.sideChatOpen';

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
  setStageFigures,
  ensureStageArtifact,
  onReload,
}: Props) {
  // The event log lives in the project store, with the artifacts it is read
  // alongside; writing goes through `appendEvent`, which re-reads the log, so
  // no surface can hold a copy the others have moved past.
  const events = useProjectStore((s) => s.events);
  const appendEvent = useProjectStore((s) => s.appendEvent);
  const refreshEvents = useProjectStore((s) => s.refreshEvents);
  const flushProject = useProjectStore((s) => s.flush);
  const [viewingStageId, setViewingStageId] = useState<string | null>(null);
  // Open by default: section 8 asks for the side chat to be part of the
  // workspace, and a panel behind a button that has to be found first is a
  // disconnected product path with an extra step.
  //
  // Except on a narrow screen, where "open" is a full-screen sheet over the
  // stage: a first visit on a phone landed on the chat, not the work (PM-08).
  // There it starts closed, and either way the user's last choice sticks.
  const [chatOpen, setChatOpenState] = useState(true);
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(CHAT_OPEN_KEY);
    } catch {
      // Storage unavailable (private window, blocked site data): use the default.
    }
    if (remembered === '0' || remembered === '1') setChatOpenState(remembered === '1');
    else if (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 1024px)').matches) {
      setChatOpenState(false);
    }
  }, []);
  const setChatOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatOpenState((open) => {
      const value = typeof next === 'function' ? next(open) : next;
      try {
        window.localStorage.setItem(CHAT_OPEN_KEY, value ? '1' : '0');
      } catch {
        // Not remembering is fine; the toggle still works.
      }
      return value;
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  // PM-06: unsaved edits in the renderer, so "Save changes" can lead.
  const [dirtyState, setDirtyState] = useState<{ dirty: boolean; save: () => Promise<void> } | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  // PM-13/14: the block form and the finish summary.
  const [blocking, setBlocking] = useState(false);
  // A5: a newer published version of this project's workflow, if any.
  const [latestTemplate, setLatestTemplate] = useState<(WorkflowTemplate & { id: string }) | null>(null);
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [finishing, setFinishing] = useState<{ option: TransitionOption; note?: string } | null>(null);
  // PM-14: the deliverable scored against the objective before finishing.
  const [objectiveCheck, setObjectiveCheck] = useState<{
    running: boolean;
    result: EvaluationResult | null;
    error: string | null;
  }>({ running: false, result: null, error: null });
  const objectiveCheckRef = useRef<EvaluationResult | null>(null);
  useEffect(() => {
    objectiveCheckRef.current = objectiveCheck.result;
  }, [objectiveCheck.result]);
  // Live section counts reported by the outline panel, which owns its own
  // unsaved draft (PM-01). Keyed by stage id.
  const [outlineCounts, setOutlineCounts] = useState<Record<string, number>>({});
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  // Below md the rail is not on the page; this is the drawer that replaces it.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // Go mode drafts stages itself; the entry auto-draft must not race it.
  const [goDriving, setGoDriving] = useState(false);

  /**
   * FR-18: attribute this project's usage rows.
   *
   * `apiFetch` is a generic transport with no idea which project a call belongs
   * to, and threading a project id through all ~25 API methods to tell it would
   * be a lot of churn for a telemetry field. The workspace knows, so it says so
   * once here — the same shape the project store already uses to scope itself.
   *
   * Cleared on unmount so a call made from outside a project (the project list,
   * smart setup) is not mislabelled with whichever project was open last.
   */
  useEffect(() => {
    setUsageProject(project.id);
    return () => setUsageProject(null);
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
  // A stage moved past with requirements still open can be worked on when
  // viewed: that is how its box gets ticked and the stage closed (PM-13,
  // Sean 28 Sep item 20 — Positioning stayed OPEN to the end because nothing
  // reachable could close it).
  const viewedState = state.stages[stageId];
  // …and a done stage reopened for editing (C5) is in progress again.
  const isEditable = isCurrent || viewedState?.status === 'in_progress';
  const reopenedHere = !isCurrent && viewedState?.status === 'in_progress' && !viewedState.left_open;
  // A skipped stage can be come back to as well as a done one (1 Oct, item 11).
  const canReopen = !isCurrent && (isDone(viewedState?.status) || viewedState?.status === 'skipped') && project.status !== 'finalized';

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
    enabled: Boolean(appendStageVersion) && isCurrent && events !== null && !goDriving,
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
   * The exit-criteria context, built once for every stage (lib/workflow/context.ts).
   *
   * Per-stage rather than per-viewed-stage: Go evaluates the stage the project
   * is on while the user may be browsing another, and both must see the same
   * facts.
   */
  const context: StageContext = useMemo(
    () =>
      buildStageContext({
        template,
        project,
        bundles: stageBundles,
        projectVersions: versions,
        events: events ?? [],
        outlineCounts,
      }),
    [project, versions, template, stageBundles, events, outlineCounts]
  );

  // PM-06: the step a panel-driven stage (outline, drafting, revision) is
  // waiting on. Keyed by stage, and a withdrawal only clears its own stage's
  // report, so an unmounting panel cannot wipe the next stage's step.
  const [panelSteps, setPanelSteps] = useState<Record<string, ReportedPanelStep>>({});
  const reportPanelStep = useCallback((stageId: string, step: ReportedPanelStep | null) => {
    setPanelSteps((prev) => {
      if (!step) {
        if (!(stageId in prev)) return prev;
        const next = { ...prev };
        delete next[stageId];
        return next;
      }
      return { ...prev, [stageId]: step };
    });
  }, []);

  const reportOutlineCount = useCallback(
    (count: number) => {
      if (!stage) return;
      setOutlineCounts((prev) => (prev[stage.id] === count ? prev : { ...prev, [stage.id]: count }));
    },
    [stage]
  );

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
  // "12 done · 1 left open · 0 to go" rather than "12 done · 1 to go" on a
  // finished project: a stage moved past is named for what it is.
  const progressCaption = useMemo(() => {
    const finished = state.project_status === 'finalized';
    return [
      finished ? 'Finished' : null,
      `${progress.complete} done`,
      progress.skipped > 0 ? `${progress.skipped} skipped` : null,
      progress.leftOpen > 0 ? `${progress.leftOpen} left open` : null,
      progress.remaining > 0 || !finished ? `${progress.remaining} to go` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [progress, state.project_status]);
  // 0-based position of the stage on screen. Read twice — by the stage header
  // and by the narrow-viewport bar — so it is derived once.
  const stageIndex = template.stages.findIndex((s) => s.id === stage?.id);

  const stageVersionList = useMemo(
    () => (stage ? stageBundles[stage.id]?.versions ?? [] : []),
    [stage, stageBundles]
  );
  const headVersion = useMemo(() => stageVersionList.at(-1) ?? null, [stageVersionList]);
  const shownEvaluation = evaluations?.[activeVersionId ?? headVersion?.id ?? ''];

  // A stage's unsaved edits belong to that stage.
  useEffect(() => {
    setDirtyState(null);
    setConfirmingRegenerate(false);
  }, [stage?.id]);

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
      setTransitionError(null);
      try {
        // PM-13: moving on with the stage's requirements met completes it;
        // moving on without them ("Continue anyway") leaves it open. The
        // legacy stage_completed is no longer written.
        const type =
          option.kind === 'skip'
            ? 'stage_skipped'
            : option.kind === 'return'
              ? 'stage_returned'
              : evaluation.canAdvance
                ? 'stage_marked_complete'
                : 'stage_advanced';

        // The stage's own head version is the evidence of completion; the
        // database checks it belongs to this stage (20260927000000).
        // The head version — or, for a long-form stage, a snapshot of the
        // finished manuscript saved now (A2). One function for every path
        // that completes a stage.
        const evidenceId =
          type === 'stage_marked_complete'
            ? await stageEvidence({ template, stage, bundles: stageBundles, project, appendStageVersion })
            : undefined;

        // Record what this stage concluded before leaving it. Later stages
        // generate against this summary, so writing it at completion — rather
        // than recomputing at every call — means a subsequent edit upstream
        // cannot silently rewrite the context a downstream draft was given.
        if ((type === 'stage_marked_complete' || type === 'stage_advanced') && setStageSummary) {
          const summary = summariseStageContent(stage, stageContentForSummary(template, stage, stageBundles));
          if (summary) await setStageSummary(stage.id, summary).catch(() => {});
        }
        // ...and the figures it established, so later stages quote them
        // instead of working them out again (1 Oct, item 32). Read from the
        // stage's own text; never a reason the move fails.
        if (type === 'stage_marked_complete' && setStageFigures) {
          const figures = await readStageFigures(project, stage, stageBundles[stage.id]?.versions.at(-1), stageBundles[stage.id]?.artifact?.key_figures);
          if (figures) await setStageFigures(stage.id, figures).catch(() => {});
        }

        let fresh = await appendEvent({
          type,
          stage_id: stage.id,
          to_stage_id: option.toStageId ?? undefined,
          reason: note,
          proposal_id: proposalId ?? null,
          ...(evidenceId ? { payload: { evidence_version_id: evidenceId } } : {}),
          // What the stage held when it was left open, so that closing it
          // later on something else can flag the stages after it.
          ...(type === 'stage_advanced' && stageBundles[stage.id]?.versions.at(-1)
            ? { payload: { left_version_id: stageBundles[stage.id]!.versions.at(-1)!.id } }
            : {}),
        });

        // PM-14: finishing the project is its own event, separate from the
        // last stage — the project can be finished with stages left open.
        if (option.kind === 'finish') {
          const checked = objectiveCheckRef.current;
          fresh = await appendEvent({
            type: 'project_finalized',
            stage_id: stage.id,
            reason: note,
            // What the deliverable scored against the objective when the user
            // finished, if they asked. The record of "finished" says how well.
            ...(checked
              ? {
                  payload: {
                    objective_check: {
                      alignment: checked.alignment.score,
                      clarity: checked.clarity.score,
                      drift: checked.drift.score,
                      completeness: checked.completeness?.status ?? null,
                    },
                  },
                }
              : {}),
          });
        }

        setViewingStageId(null);

        // projects.stage is a denormalised cursor for the list view; the event
        // log stays the record.
        const moved = projectState(template, fresh).current_stage_id;
        // Finishing the last stage finishes the project (PM-03). It used to
        // record the stage and change nothing else, so the page looked exactly
        // as it did before the click and the button seemed dead.
        if (option.kind === 'finish') onPatchProject({ status: 'finalized', stage: moved });
        else if (moved !== project.stage) onPatchProject({ stage: moved });
      } catch (e) {
        // Was swallowed: the bar did not await this, so a failed insert became
        // an unhandled rejection and the click looked like it did nothing.
        setTransitionError(
          e instanceof Error && e.message
            ? `That didn't go through: ${e.message}. Nothing was changed, so you can try again.`
            : "That didn't go through. Nothing was changed, so you can try again."
        );
      } finally {
        setBusy(false);
      }
    },
    [stage, busy, project, template, onPatchProject, setStageSummary, setStageFigures, stageBundles, evaluation, appendEvent, appendStageVersion]
  );

  /** PM-13: mark the current stage blocked, or lift the block. */
  const setBlocked = useCallback(
    async (block: { kind: BlockKind; reason: string } | null) => {
      if (!stage) return;
      setTransitionError(null);
      try {
        await appendEvent(block
          ? { type: 'stage_blocked', stage_id: stage.id, reason: block.reason, payload: { block_kind: block.kind } }
          : { type: 'stage_unblocked', stage_id: stage.id });
        setBlocking(false);
      } catch (e) {
        setTransitionError(`That didn't go through${e instanceof Error && e.message ? `: ${e.message}` : ''}. Nothing was changed.`);
      }
    },
    [stage, appendEvent]
  );

  /**
   * PM-13: finish a stage without leaving it — or finish one that was left
   * open earlier. Continue already completes a stage whose requirements are
   * met; this is the same event with no move, for the user who wants to record
   * "done" and stay, or come back and close a stage they moved past.
   */
  /** C5: a done stage, back to in progress without moving the cursor. */
  const reopenStage = useCallback(async () => {
    if (!stage) return;
    setTransitionError(null);
    try {
      await appendEvent({ type: 'stage_reopened', stage_id: stage.id });
    } catch (e) {
      setTransitionError(`That didn't go through${e instanceof Error && e.message ? `: ${e.message}` : ''}. Nothing was changed.`);
    }
  }, [stage, appendEvent]);

  const markComplete = useCallback(async () => {
    if (!stage) return;
    setTransitionError(null);
    try {
      const evidenceId = await stageEvidence({ template, stage, bundles: stageBundles, project, appendStageVersion });
      await appendEvent({
        type: 'stage_marked_complete',
        stage_id: stage.id,
        ...(evidenceId ? { payload: { evidence_version_id: evidenceId } } : {}),
      });
    } catch (e) {
      setTransitionError(`That didn't go through${e instanceof Error && e.message ? `: ${e.message}` : ''}. Nothing was changed.`);
    }
  }, [stage, template, stageBundles, project, appendStageVersion, appendEvent]);

  useEffect(() => {
    let live = true;
    getLatestTemplate(template.key)
      .then((latest) => {
        if (live) setLatestTemplate(latest && latest.version > template.version ? latest : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [template.key, template.version]);

  const upgradeTemplate = useCallback(async () => {
    if (!latestTemplate || !stage) return;
    setUpgrading(true);
    setTransitionError(null);
    try {
      // The event first: the log records the re-pin, and a failed patch after
      // it leaves an honest trail rather than a silent change.
      await appendEvent({
        type: 'template_upgraded',
        stage_id: stage.id,
        payload: {
          from_template_id: project.workflow_template_id,
          from_version: template.version,
          to_template_id: latestTemplate.id,
          to_version: latestTemplate.version,
        },
      });
      onPatchProject({ workflow_template_id: latestTemplate.id });
    } catch (e) {
      setTransitionError(`The upgrade didn't go through${e instanceof Error && e.message ? `: ${e.message}` : ''}. Nothing was changed.`);
    } finally {
      setUpgrading(false);
    }
  }, [latestTemplate, stage, project.workflow_template_id, template.version, onPatchProject, appendEvent]);

  const reopenProject = useCallback(async () => {
    if (!stage) return;
    try {
      await appendEvent({ type: 'project_reopened', stage_id: stage.id });
    } finally {
      onPatchProject({ status: 'active' });
    }
  }, [stage, onPatchProject, appendEvent]);

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
  const tools = useStageTools({ project, stage: stage ?? null, headVersion, appendStageVersion });
  // PM-22: every "apply" after a critique goes through one path.
  // A table stage is revised as rows by the generator that drafted it; sent
  // through the text revision it came back as prose and the table was lost.
  const tableRevision = useMemo(
    () =>
      stage && rendererHoldsItems(stage.renderer)
        ? {
            stage,
            request: (instruction: string) =>
              generationRequest(project, template, state, stageBundles, stage, headVersion?.content ?? '', instruction),
          }
        : undefined,
    [stage, project, template, state, stageBundles, headVersion]
  );
  const applyFindings = useApplyFindings({ project, stage, headVersion, appendStageVersion, table: tableRevision });
  // --- side-chat answers as a few actions (1 Oct, items 13, 15, 34) -------------
  const headItems = useMemo(() => parseItems(headVersion?.content) ?? [], [headVersion]);
  const suggestReplyActions = useCallback(
    async (question: string, reply: string, signal: AbortSignal) => {
      if (!stage) return [];
      const schema = itemSchemaFor(stage);
      const res = await api.suggestActions(
        {
          inputs: inputsFrom(project),
          stage_label: stage.label,
          question,
          reply,
          table: rendererHoldsItems(stage.renderer)
            ? {
                item_label: schema.itemLabel,
                fields: schema.fields.map((f) => ({ key: f.key, label: f.label })),
                // Only what the user could choose themselves.
                statuses: (schema.statuses ?? [])
                  .filter((s) => s.settable !== false && s.decided !== false)
                  .map((s) => ({ value: s.value, label: s.label, requires_reason: Boolean(s.requiresReason) })),
                rows: headItems.map((item) =>
                  Object.fromEntries(Object.entries(item).filter(([k, v]) => typeof v === 'string' && k !== 'status_source')) as Record<string, string>
                ),
              }
            : null,
          model: project.model,
        },
        signal
      );
      return res.actions;
    },
    [stage, project, headItems]
  );
  const previewReplyRows = useCallback(
    (action: ReplyAction) => (stage ? previewRowAction(headItems, action, itemSchemaFor(stage)).changes : []),
    [stage, headItems]
  );
  const runReplyAction = useCallback(
    async (action: ReplyAction) => {
      if (!stage || !appendStageVersion) return;
      if (action.kind === 'revise') {
        // One finding, the ordinary apply path: previewed before it is saved.
        await applyFindings.apply(
          [{ id: `chat-${Date.now()}`, category: 'Side chat', summary: action.label, suggested_change: action.instruction ?? '' }],
          { showFirst: true, source: 'the side chat' }
        );
        return;
      }
      const { items, changes } = previewRowAction(headItems, action, itemSchemaFor(stage));
      if (!changes.length) throw new Error('Nothing in the table would change.');
      await appendStageVersion(stage.id, stage.label, {
        content: serializeItems(items),
        source_operation: 'chat_rows',
        instruction: action.label,
        model: project.model,
        mode: project.mode,
        change_summary: `From the side chat: ${action.label} (${changes.length} row${changes.length === 1 ? '' : 's'}).`,
      });
    },
    [stage, appendStageVersion, applyFindings, headItems, project.model, project.mode]
  );

  const critiquePoints = useMemo(
    () => (tools.commentary ? pointsFromCommentary(tools.commentary.text) : []),
    [tools.commentary]
  );

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
    async (id: string, checked: boolean) => {
      const manual_checks = { ...(project.manual_checks ?? {}), [id]: checked };
      onPatchProject({ manual_checks });

      // Ticking the last required box on a stage that was left open closes
      // it. The tick is the user's declaration, so the event is theirs
      // (actor 'user'); the cursor stays where it is. The patch is flushed
      // first so a reload never shows a completed stage with an unticked box.
      if (!checked || !tickClosesStage(template, state, stageId, { ...context, manualChecks: manual_checks })) return;
      setTransitionError(null);
      try {
        await flushProject();
        const evidenceId = stage
          ? await stageEvidence({ template, stage, bundles: stageBundles, project, appendStageVersion })
          : undefined;
        await appendEvent({
          type: 'stage_marked_complete',
          stage_id: stageId,
          ...(evidenceId ? { payload: { evidence_version_id: evidenceId } } : {}),
        });
      } catch (e) {
        setTransitionError(`The box is ticked, but the stage could not be closed${e instanceof Error && e.message ? `: ${e.message}` : ''}.`);
      }
    },
    [project, onPatchProject, template, state, stageId, stage, context, flushProject, stageBundles, appendEvent, appendStageVersion]
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

  // Look the rows up in OpenAlex (1 Oct, item 12). The rows come back
  // unsaved; the user reads what was found and saves.
  const lookupItems = useCallback(
    async (items: StageItem[]) => {
      const schema = itemSchemaFor(stage!);
      const works = items
        .map((i) => ({ id: i.id, work: (i[schema.lookup!.field] ?? '').trim() }))
        .filter((w) => w.work)
        .slice(0, 20);
      if (!works.length) return { items, message: 'There is nothing named to look up yet.' };
      const { matches } = await api.agentLiterature(works);
      const result = applyLookup(items, matches, schema);
      return { items: result.items, message: lookupSummary(result, schema.itemLabel) };
    },
    [stage]
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

  const startingForm = useMemo(() => defaultOutlineForm(template, project), [template, project]);
  const deriveOutline = useCallback(
    (form?: 'full' | 'compact') => deriveOutlineItems(template, state, stageBundles, { form: form ?? startingForm }),
    [template, state, stageBundles, startingForm]
  );
  const forms = useMemo(() => outlineForms(template), [template]);
  const formOfOutline = useCallback((items: { id: string }[]) => formOfItems(template, items), [template]);

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
      if (!target) throw new Error('This stage has nowhere to keep a draft yet. Reload the page and try again.');

      await materialiseOutlineInto(doc, target);
      onReload?.();
    },
    [draftingStage, stage, stageArtifact, stageBundles, ensureStageArtifact, onReload]
  );

  // --- Go mode (B4, PM-17 … PM-20) ------------------------------------------------
  // After a stage event the run caused, the log is re-read and the list-view
  // cursor follows it, exactly as a transition-bar click does.
  const reloadAfterAgent = useCallback(async () => {
    const fresh = await refreshEvents();
    setViewingStageId(null);
    const moved = projectState(template, fresh).current_stage_id;
    if (moved !== project.stage) onPatchProject({ stage: moved });
  }, [refreshEvents, project.stage, template, onPatchProject]);

  const deliverableDone = useMemo(
    () => completionSummary(template, state, context).deliverableDone,
    [template, state, context]
  );

  const go = useGoLoop({
    project,
    template,
    state,
    // Go works the stage the project is on, never one the user is browsing.
    stage: getStage(template, state.current_stage_id),
    bundles: stageBundles,
    context,
    stageEvaluation: evaluateStage(template, state.current_stage_id, context),
    latestEvaluation: evaluations?.[stageBundles[state.current_stage_id]?.versions.at(-1)?.id ?? ''] ?? null,
    approvedOutline,
    deliverableDone,
    enabled: Boolean(appendStageVersion) && events !== null,
    appendStageVersion,
    recordStageEvaluation,
    setStageSummary,
    setStageFigures,
    reloadEvents: reloadAfterAgent,
    events: events ?? [],
    loadEvents: () => listWorkflowEvents(project.id),
    onRefresh: onReload,
  });
  useEffect(() => setGoDriving(go.active || go.phase === 'awaiting'), [go.active, go.phase]);

  // What Go can ask the user for, done from its card with one click (B4):
  // the same writes the stage's own controls make.
  const goNeedsActions = useMemo(
    () => ({
      approveOutline: async (outlineStageId: string) => {
        const { artifact, versions, draft } = await loadOutline({ id: project.id, user_id: project.user_id }, outlineStageId);
        // Unsaved edits are saved first, as the panel's own "Save and approve"
        // does: the card used to send the user off to find that button.
        const head = draft
          ? await commitOutlineVersion(artifact, draft, {
              sourceOperation: 'outline_edit', changeSummary: 'Saved from Go mode before approval.',
              model: project.model, mode: project.mode,
            })
          : versions.at(-1);
        if (!head) throw new Error('There is no saved outline to approve yet.');
        await approveOutline({
          project: { id: project.id, user_id: project.user_id },
          stageId: outlineStageId,
          version: head,
          materialise: (doc) => materialiseOutline(head, doc),
        });
        await refreshEvents();
        if (draft) onReload?.();
      },
      unblock: () => setBlocked(null),
      tick: (criterionId: string) => handleToggleManual(criterionId, true),
      // The user's skip, with Go's reason as the recorded one.
      skip: async (reason: string) => {
        const option = transitions.find((t) => t.kind === 'skip');
        if (!option) throw new Error('This stage cannot be skipped.');
        await handleTransition(option, reason.slice(0, 500));
      },
      showTable: () => {
        const table = document.querySelector<HTMLElement>('[data-stage-table]');
        if (!table) return;
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // The first row still to decide, so the next keystroke is the decision.
        (table.querySelector<HTMLElement>('[data-undecided] button, [data-undecided] select') ?? table).focus({ preventScroll: true });
      },
    }),
    [project.id, project.user_id, project.model, project.mode, materialiseOutline, refreshEvents, setBlocked, handleToggleManual, onReload, transitions, handleTransition]
  );

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
  // --- PM-06: one primary action per stage -----------------------------------
  const draftable = stageDrafts(stage) && Boolean(appendStageVersion);
  const headEvaluation = headVersion ? evaluations?.[headVersion.id] : undefined;
  const hasContent = (headVersion?.content ?? '').trim().length > 0;
  const applyable = recommendations.rows.filter((r) => r.kind !== 'stage_transition' && isApplyable(r));
  const nextStage = stage.transitions.default_next ? getStage(template, stage.transitions.default_next) : null;
  const truncated =
    headVersion?.finish_reason === 'length' || headEvaluation?.completeness_status === 'incomplete';
  const primaryAction = nextStageAction({
    finished: project.status === 'finalized',
    busy: generation.generating || stageEvaluation.evaluating || busy || tools.running !== null,
    dirty: Boolean(dirtyState?.dirty),
    draftable,
    hasContent,
    truncated,
    evaluable: draftable && Boolean(stageEvaluation.evaluate),
    evaluated: Boolean(headEvaluation),
    evaluationClean: Boolean(
      headEvaluation &&
        headEvaluation.further_pass_needed !== true &&
        (headEvaluation.further_pass_needed === false ||
          (headEvaluation.alignment_score === 'High' &&
            headEvaluation.clarity_score === 'High' &&
            headEvaluation.drift_score === 'Low' &&
            (headEvaluation.findings ?? []).length === 0))
    ),
    noFurtherPassReason:
      headEvaluation?.further_pass_needed === false ? headEvaluation.further_pass_reason || null : null,
    applyableFixes: applyable.length,
    canAdvance: evaluation.canAdvance,
    isLast: !stage.transitions.default_next,
    nextLabel: nextStage?.short_label ?? null,
    panelStep: isCurrent ? (panelSteps[stage.id] ?? null) : null,
    unmetRequired: evaluation.unmet.filter((c) => c.blocking).map((c) => c.label),
  });

  // PM-10: the original core's actions — refine, realign, challenge, reframe,
  // self-audit, continue — on a prose stage that has a draft.
  const toolsAvailable = isCurrent && draftable && stage.renderer === 'prose' && hasContent;
  const runPrimary = () => {
    switch (primaryAction.kind) {
      case 'save':
        void dirtyState?.save();
        return;
      case 'draft':
        generation.generate();
        return;
      case 'evaluate':
        stageEvaluation.evaluate?.();
        return;
      case 'apply_fixes':
        recommendations.openPreview(applyable.map((r) => r.category));
        return;
      case 'continue_writing':
        void tools.run('continue');
        return;
      case 'panel':
        panelSteps[stage.id]?.run?.();
        return;
    }
  };

  const stageState = state.stages[stage.id];
  const isBlocked = stageState?.status === 'blocked';

  // PM-14: what finishing would be finishing.
  const deliverable = deliverableStage(template);
  const deliverableBundle = deliverable ? stageBundles[deliverable.id] : undefined;
  const deliverableSections = deliverableBundle?.artifact?.long_form?.outline ?? [];
  const completion = completionSummary(template, state, context);
  // The deliverable's latest objective check, for the finished screen (C4).
  const deliverableHead = completion.deliverable ? bundles?.[completion.deliverable.id]?.versions.at(-1) : undefined;
  const deliverableEvaluation = deliverableHead ? evaluations?.[deliverableHead.id] : undefined;

  /** Score the deliverable against the objective. 1 model call, on request. */
  const checkAgainstObjective = async () => {
    if (!deliverable) return;
    const content =
      deliverable.renderer === 'long_form'
        ? formatManuscript(deliverableSections)
        : (deliverableBundle?.versions.at(-1)?.content ?? '');
    if (!content.trim()) {
      setObjectiveCheck({ running: false, result: null, error: 'There is nothing written to check yet.' });
      return;
    }
    setObjectiveCheck({ running: true, result: null, error: null });
    try {
      const response = await api.evaluateStageArtifact({
        inputs: inputsFrom(project),
        stage: {
          id: deliverable.id,
          label: `${deliverable.label} — the finished deliverable`,
          renderer: 'prose',
          entry_prompt_hint: `Judge the finished deliverable against the project objective: does it deliver what was asked, for the audience named? ${deliverable.entry_prompt_hint ?? ''}`,
          artifact_kind: deliverable.expected_artifacts[0]?.kind ?? '',
          exit_criteria: [],
        },
        content,
        digest: buildStageDigest(template, state, project, stageBundles, deliverable.id),
        model: project.model,
      });
      setObjectiveCheck({ running: false, result: response.evaluation, error: null });
    } catch (e) {
      setObjectiveCheck({
        running: false,
        result: null,
        error: `The check did not run${e instanceof Error && e.message ? `: ${e.message}` : ''}. You can still finish.`,
      });
    }
  };

  // A left-open stage can be closed even after the project is finished:
  // "12 done · 1 to go" on a finished Book was exactly that stage.
  const canMarkComplete =
    evaluation.canAdvance &&
    !isDone(stageState?.status) &&
    ((isCurrent && project.status !== 'finalized') || Boolean(stageState?.left_open) || reopenedHere);

  const moreActions: MoreAction[] = [
    ...(canMarkComplete
      ? [{ id: 'mark-complete', label: 'Mark this stage complete', icon: 'task_alt', onSelect: () => void markComplete() }]
      : []),
    isBlocked
      ? { id: 'unblock', label: 'Continue this stage', icon: 'lock_open', onSelect: () => void setBlocked(null) }
      : { id: 'block', label: 'Mark as stuck…', icon: 'block', onSelect: () => setBlocking(true) },
    ...(draftable && hasContent
      ? [{ id: 'regenerate', label: 'Regenerate this stage', icon: 'refresh', onSelect: () => setConfirmingRegenerate(true) }]
      : []),
    ...(draftable && !hasContent && primaryAction.kind !== 'draft'
      ? [{ id: 'draft', label: 'Draft this stage', icon: 'auto_awesome', onSelect: () => generation.generate() }]
      : []),
    ...(toolsAvailable
      ? [
          ...(truncated && primaryAction.kind !== 'continue_writing'
            ? [{ id: 'continue', label: 'Continue writing', icon: 'play_arrow', onSelect: () => void tools.run('continue') }]
            : []),
          ...REWRITE_TOOLS.map((t) => ({ id: t.kind, label: t.label, icon: t.icon, onSelect: () => void tools.run(t.kind) })),
          ...CRITIQUE_TOOLS.map((t) => ({ id: t.kind, label: t.label, icon: t.icon, onSelect: () => void tools.run(t.kind) })),
        ]
      : []),
    ...(draftable && hasContent && Boolean(stageEvaluation.evaluate) && primaryAction.kind !== 'evaluate'
      ? [{
          id: 'evaluate',
          label: headEvaluation ? 'Check this stage again · one AI check' : 'Check this stage · one AI check',
          icon: 'rule',
          onSelect: () => stageEvaluation.evaluate?.(),
        }]
      : []),
  ];

  // Revision and editing are long-form stages with no manuscript of their own:
  // they work on the one Drafting wrote. Without this they showed "no approved
  // outline" to someone who had just finished drafting a whole book.
  const manuscript =
    stage.renderer === 'long_form' &&
    !stageArtifact?.long_form &&
    draftingStage &&
    draftingStage.id !== stage.id
      ? (stageBundles[draftingStage.id]?.artifact ?? stageArtifact)
      : stageArtifact;

  const longFormContext =
    stage.renderer === 'long_form'
      ? {
          project,
          artifactId: manuscript?.id ?? null,
          stageId: stage.id,
          state: manuscript?.long_form ?? null,
          approvedOutlineVersionId: approvedOutlineVersionId(events ?? []),
          onRefresh: () => onReload?.(),
          revise: revisionBrief(template, stage.id, stageBundles),
          onPanelStep: reportPanelStep,
          // Snapshots go on the artifact that holds the manuscript — Drafting's,
          // for Revision and Editing — through the store.
          appendManuscriptVersion:
            appendStageVersion && manuscript?.stage_id
              ? (version: NewVersion) =>
                  appendStageVersion(manuscript.stage_id!, getStage(template, manuscript.stage_id!)?.label ?? stage.label, version)
              : undefined,
          emptyHint:
            template.outline_stage === 'explicit'
              ? 'Approve an outline on the Outline stage, and drafting will follow it.'
              : `This workflow builds its outline from the stages before it. Approve it on the ${
                  draftingStage?.short_label ?? 'Drafting'
                } stage, and drafting will follow it.`,
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
          onApply={(options) => void recommendations.confirmApply(options)}
          onCancel={recommendations.closePreview}
        />
      )}

      {/* The template name and the progress line are the only persistent
          orientation anywhere in the app — where you are and how much is left.
          They were set in the smallest size available, below the stage names
          they are meant to caption. The name is now a title and the progress a
          label, so the block reads top-down instead of flat. */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 overflow-y-auto bg-[var(--surface-container-lowest)] px-2 pb-24 pt-6 md:block sidebar-scroll">
        <div className="mb-5 px-3">
          <div className="text-title text-[var(--on-surface)]">{template.name}</div>
          <div className="mt-1 text-label text-[var(--on-surface-variant)]">{progressCaption}</div>
        </div>

        <StageRail
          template={template}
          state={state}
          nextSuggestedId={nextSuggested}
          onSelect={setViewingStageId}
        />
      </aside>

      {/* Below 768px the rail is hidden and, until now, replaced by nothing at
          all: on a narrow window or a phone there was no way to see the other
          stages, let alone move between them. The same rail is offered here as
          a drawer over the work, opened from a bar that doubles as the
          orientation the desktop rail provides — it is the only place a narrow
          viewport can learn what stage it is on out of how many.

          One `StageRail`, two placements. `md:hidden` on this and `md:block`
          on the aside means exactly one is ever mounted. */}
      {mobileRailOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="absolute inset-0 bg-[var(--inverse-surface)]/40"
            onClick={() => setMobileRailOpen(false)}
            aria-hidden
          />
          <nav
            aria-label="Workflow stages"
            className="relative flex h-full w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-[var(--surface-container-lowest)] px-2 py-5 sidebar-scroll"
          >
            <div className="mb-5 flex items-start gap-2 px-3">
              <div className="min-w-0 flex-1">
                <div className="text-title text-[var(--on-surface)]">{template.name}</div>
                <div className="mt-1 text-label text-[var(--on-surface-variant)]">{progressCaption}</div>
              </div>
              <button
                onClick={() => setMobileRailOpen(false)}
                aria-label="Close stages"
                className="-mt-1 shrink-0 rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)] hover:text-[var(--on-surface)]"
              >
                <span aria-hidden className="material-symbols-outlined text-[20px]">
                  close
                </span>
              </button>
            </div>

            <StageRail
              template={template}
              state={state}
              nextSuggestedId={nextSuggested}
              onSelect={(stageId) => {
                setViewingStageId(stageId);
                // Picking a stage is the point of the drawer; leaving it open
                // over the stage you just chose hides the answer.
                setMobileRailOpen(false);
              }}
            />
          </nav>
        </div>
      )}

      <main className="min-w-0 flex-1 px-6 py-10 md:px-10">
        <div className="mx-auto max-w-[820px]">
          {/* The narrow-viewport counterpart to the rail: where you are, how
              much is left, and the way to the rest of the stages. Hidden from
              md up, where the rail itself says all three. */}
          <button
            onClick={() => setMobileRailOpen(true)}
            aria-expanded={mobileRailOpen}
            className="mb-4 flex w-full items-center gap-3 rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)] md:hidden"
          >
            <span
              aria-hidden
              className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]"
            >
              list_alt
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-title text-[var(--on-surface)]">
                {stage.short_label}
              </span>
              <span className="block text-label text-[var(--on-surface-variant)]">
                Stage {stageIndex + 1} of {template.stages.length}
                {progress.leftOpen > 0 && ` · ${progress.leftOpen} left open`} · {progress.remaining} to go
              </span>
            </span>
            <span
              aria-hidden
              className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]"
            >
              chevron_right
            </span>
          </button>

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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setViewingStageId(null)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Viewing {stageIndex > template.stages.findIndex((s) => s.id === state.current_stage_id) ? 'a later' : 'an earlier'}{' '}
                stage — back to {getStage(template, state.current_stage_id)?.short_label}
              </button>
              {/* PM-13: moved past, not finished — and closable from here, which
                  is the only place it could be once the cursor has moved on. */}
              {/* Which of the three it is, said first: looking, finishing, or
                  editing (1 Oct, item 28: "not always obvious whether I am
                  viewing it, reopening it, editing it, or changing the
                  current project state"). */}
              {!isEditable && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  {state.stages[stage.id]?.status === 'not_started' || !state.stages[stage.id]
                    ? 'Viewing only — the project has not reached this stage yet.'
                    : 'Viewing only — nothing changes while you look, and the project stays where it is.'}
                </span>
              )}
              {isEditable && !reopenedHere && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  Left open — you moved on with requirements still unticked. Tick them here, or mark it complete.
                </span>
              )}
              {/* C5: view, reopen, close again — and the work after it is
                  marked for a recheck if what it was built on changed. */}
              {reopenedHere && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  Reopened — edit it here, then mark it complete. Later stages are flagged for a recheck if this changes.
                </span>
              )}
              {canReopen && (
                <button
                  onClick={() => void reopenStage()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label font-semibold text-[var(--on-surface)] hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                  Reopen to edit
                </button>
              )}
              {canMarkComplete && !isCurrent && (
                <button
                  onClick={() => void markComplete()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label font-semibold text-[var(--on-surface)] hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-[16px]">task_alt</span>
                  Mark this stage complete
                </button>
              )}
            </div>
          )}

          {/* FR-20. Above the stage header rather than inside it: exporting is
              a property of the project, not of whichever stage happens to be
              open, and burying it in a stage would make it look like one. */}
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <FullDocumentReader
              bundle={{ project, template, state, events: events ?? [], stages: bundles ?? {}, evaluations: evaluations ?? {} }}
            />
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

          {latestTemplate && !upgradeDismissed && isCurrent && (
            <UpgradeBanner
              name={template.name}
              fromVersion={template.version}
              toVersion={latestTemplate.version}
              diff={templateDiff(template, latestTemplate)}
              busy={upgrading}
              onUpgrade={() => void upgradeTemplate()}
              onDismiss={() => setUpgradeDismissed(true)}
            />
          )}

          <StageHeader
            stage={stage}
            status={state.stages[stage.id]?.status ?? 'not_started'}
            skippedReason={state.stages[stage.id]?.skipped_reason}
            position={{ index: stageIndex + 1, total: template.stages.length }}
            onPickMode={isCurrent ? (mode) => onPatchProject({ mode: mode as Project['mode'] }) : undefined}
            currentMode={project.mode}
            leftOpen={Boolean(state.stages[stage.id]?.left_open)}
            isCurrent={isCurrent}
          />

          {isCurrent && appendStageVersion && project.status !== 'finalized' && (
            <GoPanel go={go} stageLabel={stage.label} mode={project.mode} needsActions={goNeedsActions} />
          )}
          {isCurrent && project.status === 'finalized' && (
            <ProjectFinished
              bundle={{ project, template, state, events: events ?? [], stages: bundles ?? {}, evaluations: evaluations ?? {} }}
              completion={completion}
              evaluation={deliverableEvaluation}
              onReopen={() => void reopenProject()}
              onEdit={() => {
                // Reopen, and land on the stage that holds the work itself.
                const holder = deliverableStage(template);
                void reopenProject().then(() => holder && setViewingStageId(holder.id === state.current_stage_id ? null : holder.id));
              }}
              onNewVersion={
                appendStageVersion
                  ? async () => {
                      const holder = deliverableStage(template);
                      if (!holder) return;
                      // The finished text is saved before anything can change it.
                      const kept = await keepFinishedVersion({ template, stage: holder, bundles: stageBundles, project, appendStageVersion });
                      if (!kept) throw new Error('The finished work could not be kept as a version, so nothing was reopened.');
                      await reopenProject();
                      setViewingStageId(holder.id === state.current_stage_id ? null : holder.id);
                    }
                  : undefined
              }
            />
          )}

          <div className="mb-8">
            {/* The stage's exit criteria say whether the project's setup fields
                belong here — no stage in any template asks for them twice, and
                nothing about this reads the workflow's name. */}
            {stageWantsSetup(stage) ? (
              <ProjectSetup
                project={project}
                stage={stage}
                onPatch={onPatchProject}
                readOnly={!isEditable}
              />
            ) : (
              <ProjectBrief project={project} onPatch={onPatchProject} readOnly={!isEditable} />
            )}
            <FiguresOnRecord template={template} state={state} bundles={stageBundles} />
            {/* On every stage: data is the project's, not a stage's. */}
            <ProjectData project={project} files={project.data_files ?? []} onChanged={() => onReload?.()} readOnly={project.status === 'finalized'} />

            {outlinePanelHere && (
              <div className="mb-6">
                <OutlineStagePanel
                  project={project}
                  stageId={stage.id}
                  events={events ?? []}
                  onEventsChanged={refreshEvents}
                  refreshToken={stageBundles[stage.id]?.versions.length ?? 0}
                  derive={derivedOutlineHere ? deriveOutline : undefined}
                  forms={derivedOutlineHere ? forms : undefined}
                  formOf={derivedOutlineHere ? formOfOutline : undefined}
                  defaultForm={startingForm}
                  drafts={draftBindings(
                    (draftingStage && draftingStage.id !== stage.id
                      ? stageBundles[draftingStage.id]?.artifact
                      : stageArtifact
                    )?.long_form ?? null
                  )}
                  onApproved={materialiseOutline}
                  onItemCountChange={reportOutlineCount}
                  onPanelStep={reportPanelStep}
                  readOnly={!isCurrent}
                />
              </div>
            )}

            {/* An explicit outline stage IS the panel above — dispatching the
                renderer as well would draw the "not built yet" placeholder
                underneath a working editor. A derived outline sits on the
                drafting stage, whose renderer still has work to do, so only the
                explicit case suppresses it. */}
            {explicitOutlineHere ? null : !stageDrafts(stage) &&
              stage.renderer !== 'long_form' ? (
              <CheckpointPanel />
            ) : (
              <StageRenderer
                hideStageActions={isCurrent}
                onDirtyChange={setDirtyState}
                stage={stage}
                schema={itemSchemaFor(stage)}
                versions={stageVersions}
                activeVersionId={activeVersionId}
                onSelectVersion={setActiveVersionId}
                onRestore={restore}
                onSaveContent={appendStageVersion ? saveContent : undefined}
                onSaveItems={appendStageVersion ? saveItems : undefined}
                onLookupItems={itemSchemaFor(stage).lookup ? lookupItems : undefined}
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
                readOnly={!isEditable}
                evaluation={
                  evaluations?.[
                    activeVersionId ?? stageVersions.at(-1)?.id ?? ''
                  ]
                }
                longForm={longFormContext}
              />
            )}
          </div>

          {recommendations.revision && (
            <RevisedPreview
              revision={recommendations.revision}
              busy={recommendations.busy}
              onKeep={() => void recommendations.keepRevision()}
              onDiscard={recommendations.discardRevision}
            />
          )}
          {applyFindings.pending && (
            <RevisedPreview
              revision={applyFindings.pending}
              busy={applyFindings.running}
              onKeep={() => void applyFindings.keep()}
              onDiscard={applyFindings.discard}
            />
          )}

          {isCurrent && (tools.running || tools.error || tools.commentary) && (
            <StageToolResult
              running={tools.running}
              error={tools.error}
              commentary={tools.commentary}
              onDismiss={() => {
                tools.dismissCommentary();
                tools.dismissError();
              }}
            />
          )}

          {/* PM-22 "buttonize it": each point the critique made is its own Apply. */}
          {isCurrent && draftable && tools.commentary && critiquePoints.length > 0 && (
            <div className="mb-6">
              <CritiqueActions
                title="Act on this critique"
                points={critiquePoints}
                busy={applyFindings.running}
                onApply={(ids, showFirst) =>
                  void applyFindings.apply(
                    critiquePoints.filter((p) => ids.includes(p.id)).map((p) => findingFromPoint(p, tools.commentary!.title)),
                    { showFirst, source: tools.commentary!.title }
                  )
                }
              />
            </div>
          )}

          <div className="space-y-4">
            {/* The order below is the argument. The checklist states the gap;
                the recommendations propose closing it; the evaluation is the
                evidence some of them rest on, so it sits under the thing it
                justifies rather than above it. Tasks are what was set aside,
                and the transition bar is the way out. */}
            <ExitCriteriaChecklist
              criteria={evaluation.criteria}
              manualIds={manualIds}
              onToggleManual={(id, checked) => void handleToggleManual(id, checked)}
              readOnly={!isEditable}
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
            {/* PM-21: the dials sit with the critique they shape. */}
            {isCurrent && draftable && hasContent && (
              <CritiqueStyleControl
                intensity={project.critique_intensity ?? 'standard'}
                tone={project.critique_tone ?? 'neutral'}
                onChange={onPatchProject}
              />
            )}

            <StageEvaluationPanel evaluation={shownEvaluation} />

            {/* PM-22: the easy actions after a check, on the version it checked. */}
            {isCurrent && draftable && headVersion && (evaluations?.[headVersion.id]?.findings ?? []).length > 0 && (
              <CritiqueActions
                title="Act on this check"
                points={(evaluations?.[headVersion.id]?.findings ?? []).map((f) => ({ id: f.id, text: f.summary, change: f.suggested_change }))}
                busy={applyFindings.running}
                onApply={(ids, showFirst) =>
                  void applyFindings.apply(
                    (evaluations?.[headVersion.id]?.findings ?? []).filter((f) => ids.includes(f.id)),
                    { showFirst, source: 'the stage check' }
                  )
                }
              />
            )}
            {applyFindings.running && !applyFindings.pending && (
              <p role="status" className="text-label text-[var(--on-surface-variant)]">Applying the fixes…</p>
            )}
            {applyFindings.error && (
              <div role="alert" className="flex items-start gap-3 rounded-xl bg-[var(--error-container)] px-5 py-3">
                <p className="flex-1 text-body text-[var(--on-error-container)]">{applyFindings.error}</p>
                <button onClick={applyFindings.dismissError} className="text-label text-[var(--on-error-container)] underline">Dismiss</button>
              </div>
            )}

            <TasksPanel
              tasks={recommendations.tasks}
              onResolve={(id, status) => void recommendations.resolveTask(id, status)}
              busy={recommendations.busy}
              readOnly={!isCurrent}
            />

            {/* Transitions act on the current stage only — browsing history
                must not let you advance a stage you are merely looking at. */}
            {isCurrent && project.status === 'finalized' && (
              <ProjectFinishedBanner
                onReopen={() => void reopenProject()}
                leftOpen={completion.leftOpenStages.map((s) => ({ id: s.id, label: s.short_label }))}
                onViewStage={setViewingStageId}
              />
            )}
            {isCurrent && isBlocked && stageState?.blocked && (
              <BlockedNotice kind={stageState.blocked.kind} reason={stageState.blocked.reason} onUnblock={() => void setBlocked(null)} />
            )}
            {isCurrent && blocking && (
              <BlockForm onSubmit={(block) => void setBlocked(block)} onCancel={() => setBlocking(false)} />
            )}
            {isCurrent && finishing && (
              <CompletionDialog
                summary={completion}
                busy={busy}
                check={objectiveCheck}
                onCheck={() => void checkAgainstObjective()}
                onConfirm={() => {
                  const { option, note } = finishing;
                  setFinishing(null);
                  void handleTransition(option, note);
                }}
                onCancel={() => {
                  setFinishing(null);
                  setObjectiveCheck({ running: false, result: null, error: null });
                }}
                onViewStage={(id) => {
                  setFinishing(null);
                  setViewingStageId(id);
                }}
              />
            )}
            {isCurrent && confirmingRegenerate && (
              <ConfirmOverwrite
                label={stage.short_label.toLowerCase()}
                onConfirm={() => {
                  setConfirmingRegenerate(false);
                  generation.generate({ force: true });
                }}
                onCancel={() => setConfirmingRegenerate(false)}
              />
            )}
            {/* PM-23: the planner's suggestion, beside the stage's own next step. */}
            {isCurrent && go.pendingStep && go.run?.policy === 'guided' && (
              <NextMoveCard
                step={go.pendingStep}
                stale={go.pendingStale}
                onDo={() => void go.approve()}
                onReplan={() => void go.replan()}
                onDismiss={() => void go.decline()}
              />
            )}
            {isCurrent && project.status !== 'finalized' && (
              <StageTransitionBar
                stage={stage}
                evaluation={evaluation}
                options={transitions}
                onTransition={(option, note) => {
                  // PM-14: finishing shows what is being finished, first.
                  if (option.kind === 'finish') setFinishing({ option, note });
                  else void handleTransition(option, note);
                }}
                busy={busy}
                error={transitionError}
                primary={primaryAction}
                onPrimary={runPrimary}
                more={moreActions}
                nextStageLabel={nextStage?.short_label ?? null}
                onSuggest={appendStageVersion && !go.active && !go.pendingStep ? () => void go.suggest() : undefined}
                suggesting={go.active && go.run?.policy === 'guided'}
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
              content={stageContentForChat(
                itemSchemaFor(stage),
                (activeVersionId
                  ? stageVersions.find((v) => v.id === activeVersionId)?.content
                  : undefined) ??
                  stageVersions.at(-1)?.content ??
                  ''
              )}
              headVersion={stageVersions.at(-1) ?? null}
              appendStageVersion={appendStageVersion}
              restoreStageVersion={restoreStageVersion}
              readOnly={!isEditable}
              // Revising splices into the content it was handed, so instructing
              // while reading an older version would append a version built
              // from it and lose everything since. Discussion is unaffected.
              canInstruct={
                (activeVersionId === null || activeVersionId === stageVersions.at(-1)?.id) && !rendererHoldsItems(stage.renderer)
              }
              cannotChangeBecause={
                rendererHoldsItems(stage.renderer)
                  ? 'This stage is a table. Ask about it here and the answer will offer row changes you can review, or change the rows in the table itself.'
                  : undefined
              }
              isTable={rendererHoldsItems(stage.renderer)}
              suggestActions={draftable && headVersion ? suggestReplyActions : undefined}
              previewRows={previewReplyRows}
              onRunAction={runReplyAction}
              applying={applyFindings.running}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
