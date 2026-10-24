'use client';

import { shownModeReason } from '@/lib/i18n/stage';
import { stageText, workflowName as workflowNameText, templateWord } from '@/lib/i18n/templates';
import { translate } from '@/lib/i18n/translate';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { tr } from '@/lib/i18n/store';
import { shownGoWaiting } from '@/lib/i18n/stop-reasons';
import { WebFoundNotice } from './web-found-notice';
import { formOf, inFormWords } from '@/lib/workflow/work-form';
import { modeForStage } from '@/lib/workflow/stage-mode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StageHeader } from './stage-header';
import { StageRail } from './stage-rail';
import { approvedVersions, ExitCriteriaChecklist } from './exit-criteria-checklist';
import { MORE_GROUPS, StageTransitionBar, type MoreAction } from './stage-transition-bar';
import { ConfirmOverwrite } from './renderers/stage-chrome';
import { CheckpointPanel } from './checkpoint-panel';
import { UpgradeBanner } from './upgrade-banner';
import { templateDiff } from '@/lib/workflow/upgrade';
import { BlockForm, BlockedNotice, CompletionDialog, ObjectivePausedNotice } from './stage-status-panels';
import { StageToolResult } from './stage-tool-result';
import { CRITIQUE_TOOLS, REWRITE_TOOLS, useStageTools } from './use-stage-tools';
import { FRAMING_KINDS, nextStageAction, type ReportedPanelStep } from '@/lib/workflow/next-action';
import { describeNeed } from '@/lib/agent/needs';
import { stageControls, type StageControl } from '@/lib/workflow/stage-controls';
import { inputsChanged, stageInputs } from '@/lib/workflow/stage-inputs';
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
import { CritiqueFollowUp } from './critique-follow-up';
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
  approvalPending,
  evaluateStage,
  reopenedStages,
  getStage,
  nextSuggestedStage,
  progressCaptionText,
  progressSummary,
  projectState,
  type TransitionOption,
  completionSummary,
  deliverableStage,
  describeOutstanding,
  outstandingBeyondCriteria,
  shownOutstanding,
  type OutstandingShow,
  openFindingsByStage,
  outstandingWork,
  tickClosesStage,
} from '@/lib/workflow/engine';
import { checkVerdict } from '@/lib/workflow/check-verdict';
import { buildStageDigest, formatManuscript, summariseStageContent } from '@/lib/workflow/digest';
import { goWaitingLine, objectiveUnmet } from '@/lib/workflow/objective';
import { recordFacts, supersedeFact } from '@/lib/supabase/facts';
import { factsAlreadyRecorded, planFactRecording } from '@/lib/workflow/record-facts';
import { ProjectReferences } from './project-references';
import { ProjectReaderPane } from './project-reader-pane';
import { addReference } from '@/lib/supabase/references';
import { MAX_REFERENCES } from '@/lib/workflow/references';
import { ProjectFacts } from './project-facts';
import { buildChatContext, chatContentFor } from '@/lib/workflow/chat-context';
import { starterQuestions } from '@/lib/workflow/chat-starters';
import { keepFinishedVersion, stageContentForSummary, stageEvidence } from '@/lib/workflow/evidence';
import { api } from '@/lib/api/client';
import { inputsFrom } from './use-stage-generation';
import type { EvaluationResult } from '@/types';
import { revisionBrief } from '@/lib/workflow/revision';
import { defaultOutlineForm, deriveOutlineItems, draftingStageId, formOfItems, outlineForms } from '@/lib/workflow/derived-outline';
import { OutlineStagePanel } from '@/components/outline/outline-stage-panel';
import { ProjectBrief, ProjectSetup, stageWantsSetup } from './project-setup';
import { ProjectData } from './project-data';
import { lookupAndVerify } from '@/lib/workflow/verify';
import { RefusedRevisions, refusedSince } from './refused-revisions';
import { BriefChangeNotice } from './brief-change-notice';
import { PendingChangeNotice } from './pending-change-notice';
import { NextActionBar } from './next-action-bar';
import { ProjectTimeline } from './project-timeline';
import { accentVariables } from '@/lib/appearance/colours';
import { nextAction } from '@/lib/workflow/next-step';
import { holdPendingChange, pendingChanges, settlePendingChange, type PendingChange } from '@/lib/workflow/conflict-trail';
import { keptConflictsOf } from '@/lib/workflow/routine-conflicts';
import { FactsNextStep } from './facts-next-step';
import { FactReconcileNotice } from './fact-change-list';
import { factChangesFromRevision, withMeaningChanges, type FactChange } from '@/lib/workflow/fact-reconcile';
import { useBriefChange } from './use-brief-change';
import { openBriefChange, settledChange } from '@/lib/workflow/brief-change';
import { contextFromDocuments } from '@/lib/data/extract-text';
import { ChatAttach } from './chat-attach';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { draftBindings } from '@/lib/outline/long-form';
import { approveOutline, loadOutline, materialiseOutlineInto, outlineStageFor } from '@/lib/outline/actions';
import type { OutlineDocument } from '@/types/outline';
import { isTriaged, proposableStatuses, stageDrafts, itemSchemaFor, parseItems, rendererHoldsItems, serializeItems, type StageItem } from '@/lib/workflow/stage-artifact';
import { previewRowAction } from '@/lib/workflow/row-actions';
import { readStageFigures, type StageFigures } from '@/lib/workflow/figures';
import { FiguresOnRecord } from './figures-on-record';
import { WebSources } from './web-sources';
import type { ReplyAction } from '@/types';
import { buildStageContext, measureStageContent } from '@/lib/workflow/context';
import { proposeSummary, proposeTargets } from '@/lib/workflow/proposals';
import { proposeStatuses } from '@/lib/workflow/propose';
import type { StageContext, WorkflowTemplate, BlockKind } from '@/lib/workflow/types';
import { isDone } from '@/lib/workflow/types';
import { getLatestTemplate } from '@/lib/supabase/workflow';
import { setUsageProject } from '@/lib/supabase/model-usage';
import { setRequestThinking } from '@/lib/api/thinking';
import { setRequestLanguage } from '@/lib/api/language';
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import { EventRecordedError, useProjectStore, type StageBundle } from '@/stores/project-store';
import { withAppliedInstructions } from '@/lib/workflow/applied-instructions';
import { commitOutlineVersion, approvedOutlineVersionId, ensureOutlineArtifact } from '@/lib/supabase/outline';
import type { Artifact, ArtifactVersion, Evaluation, Project, ProjectPatch, RoutineDecisions } from '@/types/project';
import { useExperience } from '@/lib/projects/experience';

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
    version: NewVersion,
    evaluation?: undefined,
    options?: { keepRecommendations?: readonly string[]; writtenFor?: string }
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
  /** Reloads the project; the promise settles when the page holds the saved state, so a caller can await it. */
  onReload?: () => Promise<void> | void;
}

/** Per-viewer convenience only: whether this person last left the side chat open. */
const CHAT_OPEN_KEY = 'pm.sideChatOpen';
/** Where the side chat stops being a full-screen sheet and sits beside the work (Tailwind `lg`). */
const CHAT_RAIL_QUERY = '(min-width: 1024px)';

/**
 * Whether the side chat starts open. On a wide screen it is a rail beside the
 * work: open by default, and the user's last choice sticks. On a narrow one it
 * is a sheet over the stage, so it always starts closed — a choice remembered
 * on a desktop must not cover the work on a phone (19 Oct, production pass).
 */
export function initialChatOpen(remembered: string | null, wide: boolean): boolean {
  if (!wide) return false;
  return remembered === '0' ? false : true;
}

/** Versions saved by applying a check's findings, by Go or by the user's Apply. */
const APPLIED_SOURCES = new Set(['agent_apply', 'applied_findings']);

export function WorkflowWorkspace({
  project: projectProp,
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
  const [experience] = useExperience();
  const simpleExperience = experience === 'simple';
  // Every request built from the project carries the instructions the user
  // applied, beside its facts (12 Oct, Atlas and Meridian).
  const project = useMemo(() => withAppliedInstructions(projectProp, template, bundles), [projectProp, template, bundles]);
  // The interface's language (client, 21 Oct); the work's own language is the project's.
  const t = useT();
  const locale = useLocale();
  // The event log lives in the project store, with the artifacts it is read
  // alongside; writing goes through `appendEvent`, which re-reads the log, so
  // no surface can hold a copy the others have moved past.
  const events = useProjectStore((s) => s.events);
  const appendEvent = useProjectStore((s) => s.appendEvent);
  // The store reads the template to know what a save reopens (H1b).
  const setStoreTemplate = useProjectStore((s) => s.setTemplate);
  useEffect(() => {
    setStoreTemplate(template);
  }, [setStoreTemplate, template]);
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
  // A narrow screen always starts closed, and its toggles are not remembered:
  // the stored choice is the wide screen's.
  const [chatOpen, setChatOpenState] = useState(true);
  const chatWide = useRef(true);
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(CHAT_OPEN_KEY);
    } catch {
      // Storage unavailable (private window, blocked site data): use the default.
    }
    chatWide.current = typeof window.matchMedia !== 'function' || window.matchMedia(CHAT_RAIL_QUERY).matches;
    setChatOpenState(initialChatOpen(remembered, chatWide.current));
  }, []);
  const setChatOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setChatOpenState((open) => {
      const value = typeof next === 'function' ? next(open) : next;
      if (chatWide.current) {
        try {
          window.localStorage.setItem(CHAT_OPEN_KEY, value ? '1' : '0');
        } catch {
          // Not remembering is fine; the toggle still works.
        }
      }
      return value;
    });
  }, []);
  // Another project read beside this one, in the side chat's slot (client
  // feedback, 21 Oct, email 4: "dual projects at the same time side-by-side").
  // Kept for this tab's session, per project.
  const readerKey = `pm.reader.${project.id}`;
  const [reader, setReaderState] = useState<{ id: string | null; open: boolean; tab: 'chat' | 'reader' }>({ id: null, open: false, tab: 'chat' });
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(readerKey) ?? 'null') as typeof reader | null;
      if (saved && typeof saved === 'object') setReaderState({ id: saved.id ?? null, open: Boolean(saved.open), tab: saved.tab === 'reader' ? 'reader' : 'chat' });
    } catch {
      // Nothing remembered: start on the chat.
    }
  }, [readerKey]);
  const setReader = useCallback((next: typeof reader) => {
    setReaderState(next);
    try {
      window.sessionStorage.setItem(readerKey, JSON.stringify(next));
    } catch {
      // Not remembering is fine.
    }
  }, [readerKey]);
  const openBeside = useCallback((id: string | null) => {
    setReader({ id, open: true, tab: 'reader' });
    setChatOpen(true);
  }, [setReader, setChatOpen]);
  const [chatPrefill, setChatPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const takePrefill = useCallback(() => setChatPrefill(null), []);
  const referenceRows = useProjectStore((s) => s.references);
  const reloadReferences = useProjectStore((s) => s.reloadReferences);
  // Phones get the chat only: the reader needs room beside the work.
  const [roomBeside, setRoomBeside] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 768px)');
    setRoomBeside(query.matches);
    const onChange = () => setRoomBeside(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  const readingTab = roomBeside && reader.open && reader.tab === 'reader';
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
  const [goDockHost, setGoDockHost] = useState<HTMLDivElement | null>(null);
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
  // Every call from this project thinks at its level (14 Oct call); off the page, Standard.
  useEffect(() => {
    setRequestThinking(project.thinking);
    return () => setRequestThinking('standard');
  }, [project.thinking]);
  // ...and the language its work is written in (client, 21 Oct).
  useEffect(() => {
    setRequestLanguage(project.language);
    return () => setRequestLanguage('en');
  }, [project.language]);

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
  // 13 Oct (Sean, 12.1): a screenplay on the Book workflow says so, and the
  // stage's words follow the form ("sequence", not "chapter").
  const workForm = useMemo(() => formOf(project), [project]);
  const shownTemplateName = workflowNameText(locale, template.key, template.name);
  const workflowName = workForm && template.key === 'book' ? t('ws.workflowForm', { name: shownTemplateName, form: workForm.label }) : shownTemplateName;
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
  // 16 Oct (Sean): "when you click on something editable but you haven't
  // clicked reopen … it explains how to edit it". Shown on the first click
  // into a finished stage's work, until another stage is opened.
  const [finishedHint, setFinishedHint] = useState<string | null>(null);
  const showFinishedHint = finishedHint === stageId;
  // "Open Output" from the chat on a later stage lands on its Edit button.
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const [focusEdit, setFocusEdit] = useState(false);
  useEffect(() => {
    if (!focusEdit || !canReopen) return;
    editButtonRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    editButtonRef.current?.focus();
    setFocusEdit(false);
  }, [focusEdit, canReopen]);

  const stageBundles = useMemo(() => bundles ?? {}, [bundles]);

  // Viewing resets per stage: a version pill selected on one stage means
  // nothing on the next — unless the timeline asked for a version there.
  const openVersionRef = useRef<string | null>(null);
  useEffect(() => setActiveVersionId(openVersionRef.current), [stageId]);

  const generation = useStageGeneration({
    project,
    template,
    state,
    stage,
    bundles: stageBundles,
    // Never start work on a stage the user is only looking at, and never
    // before the event log has loaded — the current stage is not yet known.
    enabled: Boolean(appendStageVersion) && isCurrent && events !== null && !goDriving,
    yieldToGo: goDriving,
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

  // What is still open anywhere in the project, and the part of it that is not
  // on this stage: "Ready to move on" says so too, rather than "nothing is
  // outstanding" beside a stage that needs a recheck (6 Oct).
  // The latest judgment of the objective (7 Oct): "not met" is outstanding
  // work, and the banner says what it waits for.
  const objectiveAssessment = useMemo(() => objectiveUnmet(events ?? [], project.facts ?? []), [events, project.facts]);
  // What the latest check of the current stage's draft holds against it — the
  // same verdict Go's move-on gate reads (18 Oct, Theory of Everything: the bar
  // said "Ready to move on" while Go refused to move on).
  const currentCheckSays = useMemo(() => {
    const current = getStage(template, state.current_stage_id);
    const headId = stageBundles[state.current_stage_id]?.versions.at(-1)?.id;
    return current ? checkVerdict(evaluations?.[headId ?? ''], headId, current) : null;
  }, [template, state.current_stage_id, stageBundles, evaluations]);
  const outstanding = useMemo(
    () =>
      outstandingWork(template, state, context, {
        objectiveUnmet: objectiveAssessment ? { blockers: objectiveAssessment.blockers.map((b) => b.need) } : null,
        checkSays: currentCheckSays ? { stageId: state.current_stage_id, says: currentCheckSays } : null,
      }),
    [template, state, context, objectiveAssessment, currentCheckSays]
  );
  const openFindings = useMemo(() => openFindingsByStage(outstanding), [outstanding]);
  // The last stage reads as finished while the objective is not (13 Oct, Sean,
  // workshop: "Summary appeared completed while the project remained open").
  const projectOpenOn = useMemo(() => {
    if (!objectiveAssessment || project.status === 'finalized') return null;
    const last = [...template.stages].reverse().find((s) => state.stages[s.id]?.status !== 'skipped');
    return last && isDone(state.stages[last.id]?.status) ? last.id : null;
  }, [objectiveAssessment, project.status, template, state]);
  const outstandingOther = useMemo(
    () => outstandingBeyondCriteria(outstanding, stageId).map(describeOutstanding),
    [outstanding, stageId]
  );

  // Open stages whose only required item left is the user's approval: said in
  // the header and on the rail, not only in the checklist (2 Oct, item 3).
  const approvalPendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of template.stages) {
      if (state.stages[s.id]?.status !== 'in_progress') continue;
      if (approvalPending(evaluateStage(template, s.id, context).criteria)) ids.add(s.id);
    }
    return ids;
  }, [template, state, context]);

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

  // 0-based position of the stage on screen. Read twice — by the stage header
  // and by the narrow-viewport bar — so it is derived once.
  const stageIndex = template.stages.findIndex((s) => s.id === stage?.id);

  const stageVersionList = useMemo(
    () => (stage ? stageBundles[stage.id]?.versions ?? [] : []),
    [stage, stageBundles]
  );
  const headVersion = useMemo(() => stageVersionList.at(-1) ?? null, [stageVersionList]);
  // A new version on this stage is what the page shows next, not an older
  // pill left selected (13 Oct, Sean's PINE pack: Go read the new 98-word
  // version while the page still showed the 159-word one).
  // The stage's head changes with the stage too: a version the timeline asked for is shown, once.
  useEffect(() => {
    setActiveVersionId(openVersionRef.current);
    openVersionRef.current = null;
  }, [headVersion?.id]);
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
      // Once the move itself is written, a later failure is not "nothing was
      // changed": saying so invited a retry that recorded the move twice.
      let recorded = false;
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
        }).catch((e) => {
          if (e instanceof EventRecordedError) recorded = true;
          throw e;
        });
        recorded = true;

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
        if (recorded) {
          setTransitionError(
            option.kind === 'finish' && !(e instanceof EventRecordedError)
              ? t('wsa.recordedNotFinished')
              : t('wsa.recordedNoCatchUp')
          );
          onReload?.();
          return;
        }
        // Was swallowed: the bar did not await this, so a failed insert became
        // an unhandled rejection and the click looked like it did nothing.
        setTransitionError(
          e instanceof Error && e.message
            ? t('wsa.failedRetryWhy', { message: e.message })
            : t('wsa.failedRetry')
        );
      } finally {
        setBusy(false);
      }
    },
    [stage, busy, project, template, onPatchProject, setStageSummary, setStageFigures, stageBundles, evaluation, appendEvent, appendStageVersion, onReload, t]
  );

  /** PM-13: mark the current stage blocked, or lift the block. */
  const setBlocked = useCallback(
    async (block: { kind: BlockKind; reason: string } | null) => {
      if (!stage) return;
      setTransitionError(null);
      try {
        await appendEvent(block
          ? {
              type: 'stage_blocked', stage_id: stage.id, reason: block.reason,
              payload: { block_kind: block.kind, inputs_at_block: stageInputs(project, stageBundles[stage.id]?.versions.at(-1)?.id) },
            }
          : { type: 'stage_unblocked', stage_id: stage.id });
        setBlocking(false);
      } catch (e) {
        setTransitionError(e instanceof Error && e.message ? t('wsa.failedWhy', { message: e.message }) : t('wsa.failed'));
      }
    },
    [stage, appendEvent, project, stageBundles, t]
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
      setTransitionError(e instanceof Error && e.message ? t('wsa.failedWhy', { message: e.message }) : t('wsa.failed'));
    }
  }, [stage, appendEvent, t]);

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
      setTransitionError(e instanceof Error && e.message ? t('wsa.failedWhy', { message: e.message }) : t('wsa.failed'));
    }
  }, [stage, template, stageBundles, project, appendStageVersion, appendEvent, t]);

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
      setTransitionError(e instanceof Error && e.message ? t('wsa.upgradeWhy', { message: e.message }) : t('wsa.upgrade'));
    } finally {
      setUpgrading(false);
    }
  }, [latestTemplate, stage, project.workflow_template_id, template.version, onPatchProject, appendEvent, t]);

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
  const reloadRecommendations = useProjectStore((s) => s.reloadRecommendations);
  // Changes waiting on a "which takes priority?" answer, shown on every stage (16 Oct, NORTHSTAR-2).
  const recommendationRows = useProjectStore((s) => s.recommendations);
  const upsertRecommendation = useProjectStore((s) => s.upsertRecommendation);
  const heldChanges = useMemo(() => pendingChanges(recommendationRows), [recommendationRows]);
  const [resumeChange, setResumeChange] = useState<PendingChange | null>(null);
  const [pendingShown, setPendingShown] = useState<string | null>(null);
  const takeResume = useCallback(() => setResumeChange(null), []);
  /**
   * L-93: "Apply it anyway" on a Go step that kept the record under the
   * routine-decision policy. The change is held like any change waiting on a
   * priority answer, and the usual question opens in the side chat on its stage.
   */
  const applyAnyway = useCallback(
    (step: { stage_id: string | null; params?: Record<string, unknown> | null }) => {
      const kept = keptConflictsOf(step.params);
      if (!kept || !step.stage_id) return;
      const stageId = step.stage_id;
      void holdPendingChange({
        projectId: project.id, userId: project.user_id, stageId,
        stageLabel: template.stages.find((s) => s.id === stageId)?.label ?? stageId,
        instruction: kept.instruction,
        conflicts: kept.conflicts.map((c) => ({ ...c, from_request: false })),
      }).then((row) => {
        upsertRecommendation(row);
        const held = pendingChanges([row])[0];
        if (!held) return;
        setViewingStageId(stageId === state.current_stage_id ? null : stageId);
        setChatOpen(true);
        setResumeChange(held);
      }, () => undefined);
    },
    [project.id, project.user_id, template.stages, upsertRecommendation, state.current_stage_id, setChatOpen]
  );
  const tools = useStageTools({
    project, stage: stage ?? null, headVersion, appendStageVersion, onRecorded: reloadRecommendations,
    // A long-form stage's text lives in its chapters, not in a version.
    fallbackContent: stage?.renderer === 'long_form' ? stageContentForSummary(template, stage, stageBundles) : '',
  });
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
                // Only what a change proposed from the chat may set: not a tool's
                // status, and not one that says something was actually carried out.
                statuses: proposableStatuses(schema)
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
    // `from` names where the action came from when it is not the side chat: a Challenge, a Reframe, a Self-audit.
    async (action: ReplyAction, from?: string) => {
      if (!stage || !appendStageVersion) return;
      if (action.kind === 'record_facts') {
        // The facts the user gave in the chat become the project's record,
        // with where they came from (6 Oct, email 4). The change check then
        // reopens what relied on the facts as they were. What is already on
        // record is not recorded again, and a new value supersedes the fact it
        // replaces (Sean, 14 Oct, SUMMIT: eight facts stored three times).
        const ref = { stage_id: stage.id, via: from ?? 'side chat' };
        const plan = planFactRecording(action.facts ?? [], project.facts);
        await recordFacts(
          project,
          plan.insert.map((f) => ({ statement: f.statement, subject: f.subject || null, kind: f.kind ?? 'fact', source_kind: 'chat' as const, source_ref: ref }))
        );
        for (const { old, fact } of plan.supersede) await supersedeFact(project, old, fact.statement, ref, 'chat');
        await onReload?.();
        return;
      }
      if (action.kind === 'revise') {
        // One finding, the ordinary apply path: previewed before it is saved.
        await applyFindings.apply(
          [{ id: `chat-${Date.now()}`, category: from ?? 'Side chat', summary: action.label, suggested_change: action.instruction ?? '' }],
          { showFirst: true, source: from ?? 'the side chat' }
        );
        return;
      }
      const { items, changes } = previewRowAction(headItems, action, itemSchemaFor(stage));
      if (!changes.length) throw new Error(tr('wserr.noChange'));
      await appendStageVersion(stage.id, stage.label, {
        content: serializeItems(items),
        source_operation: 'chat_rows',
        instruction: action.label,
        model: project.model,
        mode: project.mode,
        change_summary: `From ${from ?? 'the side chat'}: ${action.label} (${changes.length} row${changes.length === 1 ? '' : 's'}).`,
      });
    },
    [stage, appendStageVersion, applyFindings, headItems, project, onReload]
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
    blocked: Boolean(stage && state.stages[stage.id]?.status === 'blocked'),
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
    table: tableRevision,
    enabled: isCurrent && events !== null,
    elsewhere: outstandingOther,
  });

  const handleToggleManual = useCallback(
    async (id: string, checked: boolean) => {
      const manual_checks = { ...(project.manual_checks ?? {}), [id]: checked };
      // Which version the approval was given on (19 Oct).
      const head = stageBundles[stageId]?.versions.at(-1)?.id;
      const others = Object.fromEntries(Object.entries(project.manual_check_versions ?? {}).filter(([k]) => k !== id));
      onPatchProject({ manual_checks, manual_check_versions: checked && head ? { ...others, [id]: head } : others });

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
        setTransitionError(e instanceof Error && e.message ? t('wsa.notClosedWhy', { message: e.message }) : t('wsa.notClosed'));
      }
    },
    [project, onPatchProject, template, state, stageId, stage, context, flushProject, stageBundles, appendEvent, appendStageVersion, t]
  );

  // "Routine decisions" (5 Oct). Written through before the event, because the
  // database re-reads the column on every commit Go makes under it.
  const setRoutineDecisions = useCallback(
    async (value: RoutineDecisions) => {
      onPatchProject({ routine_decisions: value });
      try {
        await flushProject();
        await appendEvent({ type: 'routine_policy_changed', stage_id: stageId, payload: { routine_decisions: value } });
      } catch (e) {
        setTransitionError(e instanceof Error && e.message ? t('wsa.routineWhy', { message: e.message }) : t('wsa.routine'));
      }
    },
    [onPatchProject, flushProject, appendEvent, stageId, t]
  );

  // "Web access" (20 Oct): the project's switch, written through before the
  // event, so a search that follows reads it on; only the user turns it.
  const setWebAccess = useCallback(
    async (value: 'on' | 'off') => {
      onPatchProject({ web_access: value });
      try {
        await flushProject();
        await appendEvent({ type: 'web_access_changed', stage_id: stageId, payload: { web_access: value } });
      } catch (e) {
        setTransitionError(e instanceof Error && e.message ? t('wsa.webWhy', { message: e.message }) : t('wsa.web'));
      }
    },
    [onPatchProject, flushProject, appendEvent, stageId, t]
  );

  // Approvals committed under the routine-decision policy on this stage, while
  // still ticked: what the check found, for the checklist (5 Oct).
  const committedByPolicy = useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of events ?? []) {
      const id = e.type === 'criterion_committed' && e.stage_id === stageId ? String(e.payload?.criterion_id ?? '') : '';
      if (id && project.manual_checks?.[id]) out[id] = e.reason ?? '';
    }
    return out;
  }, [events, stageId, project.manual_checks]);
  // A saved change to the brief reopens only what relied on it (5 Oct).
  const judgingChange = useBriefChange({
    project, template, state, bundles: stageBundles, stageId, appendEvent,
    enabled: project.status !== 'finalized' && events !== null,
  });
  const briefChange = useMemo(() => openBriefChange(events ?? [], state), [events, state]);
  // The last step of the sequence, "Updated and checked", until dismissed.
  const [settledDismissed, setSettledDismissed] = useState<string | null>(null);
  const settled = useMemo(() => {
    const found = settledChange(events ?? [], state, Date.now());
    return found && found.event.created_at !== settledDismissed ? found : null;
  }, [events, state, settledDismissed]);

  // A version the user saved themselves that states values the facts do not
  // (10 Oct, Sean: restoring the Wednesday draft left the facts on Thursday).
  const [factReconcile, setFactReconcile] = useState<{ stageId: string; how: string; changes: FactChange[] } | null>(null);
  const offerFactUpdates = useCallback(
    (how: string, before: string, after: string) => {
      if (!stage) return;
      const changes = factChangesFromRevision({ facts: project.facts, instruction: '', before, after });
      setFactReconcile(changes.length ? { stageId: stage.id, how, changes } : null);
      // A change of meaning is found by a small AI check and added when it comes back (L-72).
      const stageId = stage.id;
      void withMeaningChanges(changes, { facts: project.facts, instruction: '', before, after, model: project.model }, (req) => api.revisionFacts(req)).then(
        (all) => all.length > changes.length && setFactReconcile({ stageId, how, changes: all })
      );
    },
    [stage, project.facts, project.model]
  );

  const saveContent = useCallback(
    async (content: string) => {
      if (!stage || !appendStageVersion) return;
      const before = headVersion?.content ?? '';
      await appendStageVersion(stage.id, stage.label, {
        content,
        source_operation: 'stage_edit',
        model: project.model,
        mode: project.mode,
        change_summary: 'Edited by hand.',
      });
      offerFactUpdates('Your edit', before, content);
    },
    [stage, appendStageVersion, project.model, project.mode, headVersion?.content, offerFactUpdates]
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
      // Found, then read: what PromptMaster can check itself, it checks (5 Oct).
      const result = await lookupAndVerify(project, items, schema);
      if (!result) return { items, message: 'There is nothing named to look up yet.' };
      return { items: result.items, message: `${result.message} Review, then save.` };
    },
    [stage, project]
  );

  const proposeItems = useCallback(
    async (items: StageItem[]) => {
      const schema = itemSchemaFor(stage!);
      const asked = proposeTargets(items, schema).length;
      const result = await proposeStatuses({ project, items, schema });
      return { items: result.items, message: proposeSummary(result.applied.length, asked) };
    },
    [stage, project]
  );

  const restore = useCallback(
    async (versionId: string) => {
      if (!stage || !restoreStageVersion) return;
      const before = headVersion?.content ?? '';
      const restored = stageVersionList.find((v) => v.id === versionId);
      await restoreStageVersion(stage.id, versionId);
      setActiveVersionId(null);
      if (restored) offerFactUpdates(`The version you restored (v${restored.version_number})`, before, restored.content);
    },
    [stage, restoreStageVersion, headVersion?.content, stageVersionList, offerFactUpdates]
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
      if (!destination) throw new Error(tr('wserr.noDrafting'));

      // Only an artifact filed under the drafting stage. The project-level
      // row (no stage) is never the manuscript of a staged workflow, and before
      // a reload the stage's bundle can still be empty. A derived outline keeps
      // the manuscript on its own outline row, so that is where it goes.
      const existing = stageBundles[destination.id]?.artifact ?? null;
      const derivedHere = outlineStageFor(template)?.id === destination.id;
      const target =
        existing ??
        (derivedHere
          ? await ensureOutlineArtifact(project.id, project.user_id, destination.id)
          : ensureStageArtifact
            ? await ensureStageArtifact(destination.id, destination.label)
            : null);
      if (!target) throw new Error(tr('wserr.noPlace'));

      await materialiseOutlineInto(doc, target);
      onReload?.();
    },
    [draftingStage, stage, stageBundles, template, project.id, project.user_id, ensureStageArtifact, onReload]
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

  // The buttons on the current stage's page, for Go to name (2 Oct, item 10).
  // Filled in further down, once the stage bar's own actions are built.
  const controlsRef = useRef<StageControl[] | null>(null);

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
    // A routine approval Go committed under the policy (5 Oct): the box is
    // ticked from the latest checks, and saved before the next move reads it.
    commitCriterion: async (_stageId: string, criterionId: string) => {
      const latest = useProjectStore.getState().project?.manual_checks ?? project.manual_checks ?? {};
      onPatchProject({ manual_checks: { ...latest, [criterionId]: true } });
      await flushProject();
    },
    // Q2e (9 Oct, production replay): Go went back and rewrote Method while
    // "I approve this analysis plan" stayed ticked from the plan it replaced.
    // Going back clears the reserved approvals of the stage it goes back to.
    reopenApprovals: async (criterionIds: string[]) => {
      const latest = useProjectStore.getState().project?.manual_checks ?? project.manual_checks ?? {};
      const cleared = Object.fromEntries(Object.entries(latest).filter(([id]) => !criterionIds.includes(id)));
      if (Object.keys(cleared).length === Object.keys(latest).length) return;
      onPatchProject({ manual_checks: cleared });
      await flushProject();
    },
    events: events ?? [],
    loadEvents: () => listWorkflowEvents(project.id),
    onRefresh: onReload,
    getControls: () => controlsRef.current,
  });

  /**
   * 13 Oct (Sean, email 1): "return to a stage, supply changes, and run Go
   * again". The reopened stage is closed on its new version when its
   * requirements hold — which reopens the work after it for a recheck — or
   * handed to Go to finish with the user's changes kept; then Go carries on
   * from where the project is, rechecking what the change affected first.
   *
   * Every reopened stage, not only the one open on screen (21 Oct, production:
   * Output was reopened and changed, Apply and continue was pressed on Summary,
   * and Output stayed "Reopened" after Go had finished).
   */
  const continueWork = useCallback(async () => {
    setTransitionError(null);
    try {
      for (const s of reopenedStages(template, state)) {
        const ev = evaluateStage(template, s.id, context);
        if (ev.canAdvance) {
          const evidenceId = await stageEvidence({ template, stage: s, bundles: stageBundles, project, appendStageVersion });
          await appendEvent({
            type: 'stage_marked_complete',
            stage_id: s.id,
            ...(evidenceId ? { payload: { evidence_version_id: evidenceId } } : {}),
          });
        } else {
          const unmet = ev.unmet.filter((c) => c.blocking).map((c) => c.label).join('; ');
          await appendEvent({
            type: 'brief_changed',
            stage_id: s.id,
            reason: `Reopened and handed to Go to finish`,
            payload: {
              kind: 'reopened',
              affected: [{ stage_id: s.id, reason: `You reopened ${s.label} and changed it. Finish it keeping every change you made${unmet ? `, so that: ${unmet}` : ''}.` }],
            },
          });
        }
      }
      // Go runs from where the user is: no jump to the current stage (17 Oct,
      // Sean: "I gotta go press authorize in summary"). `update`, not `go`:
      // the button promises the work is carried on, which Guided would not do.
      await go.applyAndContinue();
    } catch (e) {
      setTransitionError(e instanceof Error && e.message ? t('wsa.failedWhy', { message: e.message }) : t('wsa.failed'));
    }
  }, [template, state, context, stageBundles, project, appendStageVersion, appendEvent, go, t]);

  /** Stages a change left waiting for an update, by label: the next-step bar and the "Revision applied" note both say it. */
  const awaitingLabels = [...(briefChange?.stageIds ?? []), ...(briefChange?.alsoWaiting ?? [])].map(
    (id) => template.stages.find((s) => s.id === id)?.label ?? id
  );

  /** Go's panel lives on the current stage: open that and bring the panel into view. */
  const showGo = useCallback(() => {
    setViewingStageId(null);
    setTimeout(() => document.querySelector('[data-panel="go"]')?.scrollIntoView({ block: 'start' }), 100);
  }, []);

  // The one next action, at the top of whichever stage is open (17 Oct, Sean).
  const nextStep = nextAction({
    finalized: project.status === 'finalized',
    canAct: Boolean(appendStageVersion),
    heldChanges: heldChanges.length,
    reopenedHere,
    reopenedLabel: stage?.label,
    awaitingUpdate: awaitingLabels,
    goActive: go.active,
    goWorkingOn: getStage(template, state.current_stage_id)?.label,
    run: go.run ? { status: go.run.status, ended_at: go.run.ended_at, hasNeed: Boolean(go.run.needs), asking: Boolean(go.run.stop_reason) } : null,
    onCurrentStage: isCurrent,
  });
  // A paused run holds the next move too: the page drafting Realign while Go
  // proposed skipping it, or Summary while Go waited for approval to draft it,
  // made versions no Go step accounted for (Sean, 10 Oct, email 6.7). The stage
  // can still be drafted by hand from its menu.
  const goPaused = go.run?.status === 'awaiting_decision' || go.run?.status === 'blocked' || go.run?.status === 'budget_exhausted';
  useEffect(() => setGoDriving(go.active || go.phase === 'awaiting' || goPaused), [go.active, go.phase, goPaused]);

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
        if (!head) throw new Error(tr('wserr.noOutline'));
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
      keepStage: async (keepId: string) => {
        const since = state.stages[keepId]?.stale?.since;
        if (!since) return;
        await appendEvent({ type: 'brief_change_dismissed', stage_id: keepId, reason: 'Kept as it is after repairs did not settle it.', payload: { change_at: since, stage_ids: [keepId] } });
      },
      openStage: (openId: string) => setViewingStageId(openId === state.current_stage_id ? null : openId),
      // The user's skip, with Go's reason as the recorded one.
      skip: async (reason: string) => {
        const option = transitions.find((t) => t.kind === 'skip');
        if (!option) throw new Error(tr('wserr.cannotSkip'));
        await handleTransition(option, reason.slice(0, 500));
      },
      // The user's return to where the next round starts, with Go's reason.
      nextRound: async (toStageId: string, reason: string) => {
        const option = transitions.find((t) => t.kind === 'return' && t.toStageId === toStageId);
        if (!option) throw new Error(tr('wserr.noRound'));
        await handleTransition(option, reason.slice(0, 500));
      },
      showTable: () => {
        const table = document.querySelector<HTMLElement>('[data-stage-table]');
        if (!table) return;
        // The first row still to decide, so the next keystroke is the decision.
        (table.querySelector<HTMLElement>('[data-undecided] button, [data-undecided] select') ?? table).focus({ preventScroll: true });
        // Not a smooth scroll: over a long page it is slow, and in a tab that
        // is not in front it does not move at all (production pass, 2026-10-01).
        table.scrollIntoView({ block: 'start' });
      },
      showData: () => {
        const panel = document.querySelector<HTMLElement>('[data-panel="project-data"]');
        if (!panel) return;
        panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
        panel.scrollIntoView({ block: 'center' });
      },
    }),
    [project.id, project.user_id, project.model, project.mode, materialiseOutline, refreshEvents, setBlocked, handleToggleManual, onReload, transitions, handleTransition, state, appendEvent]
  );

  // For Go's card on a stuck stage: has anything changed since it was marked
  // stuck, and may the stage be skipped (2 Oct, item 9).
  const currentStageDef = getStage(template, state.current_stage_id);
  const blockedNow = state.stages[state.current_stage_id]?.blocked;
  const goNeedContext = {
    blockInputs: blockedNow
      ? inputsChanged(blockedNow.inputs, stageInputs(project, stageBundles[state.current_stage_id]?.versions.at(-1)?.id))
      : null,
    canSkip: Boolean(currentStageDef?.transitions.allow_skip && currentStageDef.transitions.default_next),
    openApprovals: (currentStageDef?.exit_criteria ?? [])
      .filter((c) => c.check === 'manual' && !project.manual_checks?.[c.id])
      .map((c) => ({ id: c.id, label: c.label })),
  };

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
  /** A stage's short name as the page shows it (client, 21 Oct): the bar and Go's list of buttons say the same. */
  const shownStageName = (id: string) => {
    const s = getStage(template, id);
    return s ? stageText(locale, template.key, s, 'short') : undefined;
  };
  // Cut off means the model stopped at its length limit. A check's
  // "incomplete" is a judgement — on 6 Oct it meant "overshoots this stage" —
  // and comes with findings to apply; offering Continue writing for it added
  // more of what was already too much (same rule as Go's, lib/agent/facts).
  const truncated = headVersion?.finish_reason === 'length';
  // The last stage's Finish, beside the acceptance box as well as in the bar (22 Oct).
  const finishHere =
    isCurrent && project.status !== 'finalized' && !stage.transitions.default_next
      ? transitions.find((o) => o.kind === 'finish')
      : undefined;
  const primaryAction = nextStageAction({
    finished: project.status === 'finalized',
    // Go working the project is busy too: a check pressed while Go appends a
    // new version scores the one it replaced (14 Oct, Sean).
    busy: generation.generating || stageEvaluation.evaluating || busy || tools.running !== null || go.active,
    dirty: Boolean(dirtyState?.dirty),
    draftable,
    hasContent,
    truncated,
    evaluable: draftable && Boolean(stageEvaluation.evaluate),
    framing: FRAMING_KINDS.has(stage.expected_artifacts[0]?.kind ?? ''),
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
    checkSays: isCurrent ? currentCheckSays : null,
    isLast: !stage.transitions.default_next,
    accepted: evaluation.criteria.some((c) => c.manual) && evaluation.criteria.filter((c) => c.manual).every((c) => c.satisfied),
    nextLabel: nextStage ? stageText(locale, template.key, nextStage, 'short') : null,
    panelStep: isCurrent ? (panelSteps[stage.id] ?? null) : null,
    unmetRequired: evaluation.unmet.filter((c) => c.blocking).map((c) => c.label),
  });

  // PM-10: the original core's actions — refine, realign, challenge, reframe,
  // self-audit, continue — on a prose stage that has a draft. On a long-form
  // stage with chapters written, only the critiques: a rewrite would land as a
  // prose version beside a manuscript that lives in `long_form.outline`.
  const toolsAvailable = isCurrent && draftable && stage.renderer === 'prose' && hasContent;
  const critiqueOnly =
    isCurrent && stage.renderer === 'long_form' && stageContentForSummary(template, stage, stageBundles).trim().length > 0;
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
  // Go's card and the stage's own notice described the same stuck stage with
  // two sets of buttons (2 Oct screenshots). While Go's run holds this block,
  // its card is the one surface; the notice returns once the run lets go.
  const goHoldsThisBlock = Boolean(
    go.run && go.run.needs?.kind === 'unblock_stage' && go.run.needs.stageId === stage.id &&
    (!go.run.ended_at || go.run.status === 'budget_exhausted')
  );
  const isBlocked = stageState?.status === 'blocked';

  // PM-14: what finishing would be finishing.
  const deliverable = deliverableStage(template);
  const deliverableBundle = deliverable ? stageBundles[deliverable.id] : undefined;
  const deliverableSections = deliverableBundle?.artifact?.long_form?.outline ?? [];
  // Go waiting on the user is outstanding work as much as an open finding is.
  const goStopped =
    go.run && !go.run.ended_at && (go.run.status === 'awaiting_decision' || go.run.status === 'blocked')
      ? go.run.stop_reason || 'a decision from you'
      : null;
  // 13 Oct (Sean, workshop): "2 still open: The objective is not met — waiting
  // for …; Go is waiting for you: Paused — the objective is not met …" was one
  // thing said twice, and after the $11 quote was rechecked Go's old stop
  // reason still said it. The objective's own item says it while it holds;
  // once a change has made it out of date, Go only needs resuming.
  const goWaiting = goWaitingLine(goStopped, Boolean(objectiveAssessment));
  // Names as the screen says them (client, 22 Oct: stage names and Go's
  // request still in English under Español). What is stored stays English.
  const stageNameShown = (id: string, field: 'label' | 'short' = 'label'): string => {
    const s = template.stages.find((x) => x.id === id);
    if (!s) return id;
    return (field === 'short' && stageText(locale, template.key, s, 'short')) || stageText(locale, template.key, s, 'label');
  };
  const shownStageByEnglish = (english: string): string => {
    const s = template.stages.find((x) => x.label === english || x.short_label === english);
    return s ? stageNameShown(s.id, s.label === english ? 'label' : 'short') : english;
  };
  // What Go waits for: its request in this language when the run still holds
  // it (the stop reason is that request's English), else the reason by shape.
  const shownGoWaitingLine = (line: string): string => {
    const need = go.run?.needs ?? null;
    if (need && line === describeNeed(need, go.stageLabelFor).message) {
      return describeNeed(need, (id) => stageNameShown(id, 'short'), {}, locale).message;
    }
    return shownGoWaiting(locale, line, shownStageByEnglish) ?? line;
  };
  const outstandingShow: OutstandingShow = { stage: (id) => stageNameShown(id, 'short'), waiting: shownGoWaitingLine };
  const outstandingOtherShown = outstandingBeyondCriteria(outstanding, stageId).map((item) => shownOutstanding(item, locale, outstandingShow));
  // Go stopped on the objective check: the pause notice offers Go's own action.
  const objectiveNeed =
    go.run && !go.run.ended_at && go.run.status === 'awaiting_decision' && go.run.needs?.kind === 'objective_check' ? go.run.needs : null;
  const completion = completionSummary(template, state, context, {
    goWaiting,
    objectiveUnmet: objectiveAssessment ? { blockers: objectiveAssessment.blockers.map((b) => b.need) } : null,
  });
  // The sidebar counts what Go stops on, not only stage statuses (12 Oct).
  const progressCaption = progressCaptionText(progress, state.project_status === 'finalized', completion.outstanding);
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
      setObjectiveCheck({ running: false, result: null, error: t('wsa.nothingToCheck') });
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
        error: e instanceof Error && e.message ? t('wsa.checkDidNotRunWhy', { message: e.message }) : t('wsa.checkDidNotRun'),
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
      ? [{ id: 'mark-complete', label: t('ws.markComplete'), icon: 'task_alt', group: MORE_GROUPS.stage, hint: t('wsa.markCompleteHint'), onSelect: () => void markComplete() }]
      : []),
    isBlocked
      ? { id: 'unblock', label: t('wsa.continueStage'), icon: 'lock_open', group: MORE_GROUPS.stage, hint: t('wsa.continueStageHint'), onSelect: () => void setBlocked(null) }
      : { id: 'block', label: t('wsa.markStuck'), icon: 'block', group: MORE_GROUPS.stage, hint: t('wsa.markStuckHint'), onSelect: () => setBlocking(true) },
    ...(draftable && hasContent
      ? [{ id: 'regenerate', label: t('wsa.regenerate'), icon: 'refresh', group: MORE_GROUPS.stage, hint: t('wsa.regenerateHint'), onSelect: () => setConfirmingRegenerate(true) }]
      : []),
    ...(draftable && !hasContent && primaryAction.kind !== 'draft'
      ? [{ id: 'draft', label: t('na.draftStage'), icon: 'auto_awesome', group: MORE_GROUPS.stage, hint: t('wsa.draftHint'), onSelect: () => generation.generate() }]
      : []),
    ...(toolsAvailable
      ? [
          ...(truncated && primaryAction.kind !== 'continue_writing'
            ? [{ id: 'continue', label: t('na.continueWriting'), icon: 'play_arrow', group: MORE_GROUPS.stage, hint: t('wsa.continueHint'), onSelect: () => void tools.run('continue') }]
            : []),
          ...REWRITE_TOOLS.map((tool) => ({ id: tool.kind, label: t(`tool.${tool.kind}`), icon: tool.icon, group: MORE_GROUPS.rewrite, onSelect: () => void tools.run(tool.kind) })),
          ...CRITIQUE_TOOLS.map((tool) => ({ id: tool.kind, label: t(`tool.${tool.kind}`), icon: tool.icon, group: MORE_GROUPS.critique, onSelect: () => void tools.run(tool.kind) })),
        ]
      : critiqueOnly
        ? CRITIQUE_TOOLS.map((tool) => ({ id: tool.kind, label: t(`tool.${tool.kind}`), icon: tool.icon, group: MORE_GROUPS.critique, onSelect: () => void tools.run(tool.kind) }))
        : []),
    ...(draftable && hasContent && Boolean(stageEvaluation.evaluate) && primaryAction.kind !== 'evaluate'
      ? [{
          id: 'evaluate',
          label: headEvaluation ? t('wsa.checkAgain') : t('wsa.checkOnce'),
          icon: 'rule',
          group: MORE_GROUPS.stage,
          hint: t('wsa.checkHint'),
          onSelect: () => stageEvaluation.evaluate?.(),
        }]
      : []),
  ];

  // What Go may name is what the stage bar and the page draw, built from the
  // same values. Only for the stage the project is on: a stage being browsed
  // shows other buttons, and Go does not work there.
  const pageControls = isCurrent && project.status !== 'finalized'
    ? stageControls({
        primary: primaryAction,
        more: moreActions,
        options: transitions,
        nextStageLabel: nextStage ? stageText(locale, template.key, nextStage, 'short') : null,
        stageName: shownStageName,
        openApprovals: evaluation.criteria.filter((c) => c.manual && !c.satisfied),
        lookupNoun: rendererHoldsItems(stage.renderer) && hasContent ? (itemSchemaFor(stage).lookup?.noun ?? null) : null,
        dataPanel: true,
        proposals: context.itemsProposed?.[stage.id] ?? 0,
        proposeRows: rendererHoldsItems(stage.renderer) && proposeTargets(parseItems(stageBundles[stage.id]?.versions.at(-1)?.content) ?? [], itemSchemaFor(stage)).length > 0,
      })
    : null;
  // Read by the Go loop when it plans a move, never during render.
  controlsRef.current = pageControls;
  // Check and chapter stages: the work is the table or the chapters, so the
  // supporting panels fold to a line each (3 Oct call).
  // The simple setup folds them on every stage (Sean, 18 Oct, email 7): the
  // checklist still opens by itself when a box is the user's to tick.
  const foldStageExtras = simpleExperience || stage.renderer === 'review' || stage.renderer === 'long_form';
  const showDials = isCurrent && draftable && hasContent;
  const dials = (
    <CritiqueStyleControl
      intensity={project.critique_intensity ?? 'standard'}
      tone={project.critique_tone ?? 'neutral'}
      onChange={onPatchProject}
    />
  );
  const chatEditsProse =
    !rendererHoldsItems(stage.renderer) && stage.renderer !== 'outline' && stage.renderer !== 'long_form';
  // 15–17 Oct (Sean): "Should we be able to change it in summary?" A later
  // stage that cannot rewrite the deliverable says where it is changed, with
  // the way there — rather than leaving "Change it" greyed out.
  const editElsewhere =
    isCurrent && !chatEditsProse && deliverable && deliverable.id !== stage.id &&
    isDone(state.stages[deliverable.id]?.status) && project.status !== 'finalized'
      ? {
          label: deliverable.short_label,
          onOpen: () => {
            setViewingStageId(deliverable.id);
            setFocusEdit(true);
          },
        }
      : undefined;
  // The stuck card names the stage bar's own transition button in the words
  // that are on the page ("Continue to X" or "Override and continue to X").
  // The stage Go is asking about, when its newest version came from applied
  // findings: the question card shows what that version changed (19 Oct).
  const goAskedOn = go.steps.at(-1)?.stage_id ?? state.current_stage_id;
  const [goPrior, goLatest] = goAskedOn ? (stageBundles[goAskedOn]?.versions ?? []).slice(-2) : [];
  const goLatestChange = goPrior && goLatest && APPLIED_SOURCES.has(goLatest.source_operation)
    ? {
        stageLabel: template.stages.find((s) => s.id === goAskedOn)?.label ?? 'the stage',
        version: goLatest.version_number, previous: goPrior.version_number,
        before: goPrior.content, after: goLatest.content, summary: goLatest.change_summary ?? '',
      }
    : null;

  const goNeedContextOnPage = {
    ...goNeedContext,
    advanceControl: pageControls?.find((c) => c.id === 'advance')?.label ?? null,
  };

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
          revise: revisionBrief(template, stage.id, stageBundles, state),
          stageHint: stage.entry_prompt_hint,
          onPanelStep: reportPanelStep,
          // Snapshots go on the artifact that holds the manuscript — Drafting's,
          // for Revision and Editing — through the store.
          appendManuscriptVersion:
            appendStageVersion && manuscript?.stage_id
              ? (version: NewVersion) =>
                  appendStageVersion(manuscript.stage_id!, getStage(template, manuscript.stage_id!)?.label ?? stage.label, version, undefined, { writtenFor: stage.id })
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
    // The project's own accent, if it has one (14 Oct call), for everything on its page.
    <div className="flex min-h-screen" style={accentVariables(project.accent) as React.CSSProperties}>
      {/* FR-09: what is about to happen, before it happens. Opening this makes
          no model call — everything on it is computed from rows already in
          memory, and nothing is spent until Apply is pressed. */}
      {recommendations.previewing && (
        <ApplyPreview
          selected={recommendations.previewRows}
          headVersionNumber={headVersion?.version_number ?? null}
          stageLabel={stageText(locale, template.key, stage, 'short')}
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
          <div className="text-title text-[var(--on-surface)]">{workflowName}</div>
          <div className="mt-1 text-label text-[var(--on-surface-variant)]">{progressCaption}</div>
        </div>

        <StageRail
          template={template}
          state={state}
          nextSuggestedId={nextSuggested}
          onSelect={setViewingStageId}
          approvalPendingIds={approvalPendingIds}
          projectOpenOn={projectOpenOn}
          openFindings={openFindings}
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
            aria-label={t('rail.label')}
            className="relative flex h-full w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-[var(--surface-container-lowest)] px-2 py-5 sidebar-scroll"
          >
            <div className="mb-5 flex items-start gap-2 px-3">
              <div className="min-w-0 flex-1">
                <div className="text-title text-[var(--on-surface)]">{workflowName}</div>
                <div className="mt-1 text-label text-[var(--on-surface-variant)]">{progressCaption}</div>
              </div>
              <button
                onClick={() => setMobileRailOpen(false)}
                aria-label={t('ws.closeStages')}
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
              projectOpenOn={projectOpenOn}
              openFindings={openFindings}
              nextSuggestedId={nextSuggested}
              approvalPendingIds={approvalPendingIds}
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
          {/* Go's controls, pinned while its panel is scrolled away (2 Oct: "you should see
              [the play button] all the time"). The panel fills this; it is empty otherwise. */}
          {isCurrent && appendStageVersion && project.status !== 'finalized' && (
            <div ref={setGoDockHost} className="sticky top-3 z-20 empty:hidden" />
          )}
          {/* The narrow-viewport counterpart to the rail: where you are, how
              much is left, and the way to the rest of the stages. Hidden from
              md up, where the rail itself says all three. */}
          <button
            onClick={() => setMobileRailOpen(true)}
            aria-expanded={mobileRailOpen}
            className="mb-4 flex w-full items-center gap-3 rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 text-start transition-colors hover:bg-[var(--surface-container-low)] md:hidden"
          >
            <span
              aria-hidden
              className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]"
            >
              list_alt
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-title text-[var(--on-surface)]">
                {stageText(locale, template.key, stage, 'short')}
              </span>
              <span className="block text-label text-[var(--on-surface-variant)]">
                {t('stageHead.position', { index: stageIndex + 1, total: template.stages.length })}
                {progress.leftOpen > 0 && t('ws.leftOpenCount', { count: progress.leftOpen })}{t('ws.toGo', { count: progress.remaining })}
              </span>
            </span>
            <span
              aria-hidden
              className="material-symbols-outlined text-[20px] text-[var(--on-surface-variant)]"
            >
              chevron_right
            </span>
          </button>

          <div className="mb-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openBeside(reader.id)}
              className="hidden items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] md:inline-flex"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                splitscreen_right
              </span>
              {reader.id ? t('ws.otherProject') : t('ws.openAnother')}
            </button>
            <button
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              aria-controls="stage-side-chat"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">
                forum
              </span>
              {chatOpen ? t('ws.hideChat') : t('ws.sideChat')}
            </button>
          </div>

          {!isCurrent && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setViewingStageId(null)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                <span className="material-symbols-outlined rtl:-scale-x-100 text-[16px]">arrow_back</span>
                {t(stageIndex > template.stages.findIndex((s) => s.id === state.current_stage_id) ? 'ws.viewingLater' : 'ws.viewingEarlier', {
                  stage: (() => {
                    const here = getStage(template, state.current_stage_id);
                    return here ? stageText(locale, template.key, here, 'short') : '';
                  })(),
                })}
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
                    ? t('ws.notReached')
                    : t('ws.viewOnly')}
                </span>
              )}
              {isEditable && !reopenedHere && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  {t('ws.leftOpenNote')}
                </span>
              )}
              {/* C5: view, reopen, close again — and the work after it is
                  marked for a recheck if what it was built on changed. */}
              {reopenedHere && (
                <span className="text-label text-[var(--on-surface-variant)]">
                  {t('ws.reopenedNote')}
                </span>
              )}
              {/* 16 Oct (Sean): "Reopen and edit button should be more
                  prominent" — the one way to change finished work, so it is
                  the primary button, with what it does said beside it. */}
              {canReopen && (
                <>
                  <button
                    ref={editButtonRef}
                    onClick={() => void reopenStage()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-3.5 py-1.5 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/50 focus:ring-offset-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    {t('ws.editStage')}
                  </button>
                  <span className="text-label text-[var(--on-surface-variant)]">{t('ws.recheckNote')}</span>
                </>
              )}
              {canMarkComplete && !isCurrent && (
                <button
                  onClick={() => void markComplete()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label font-semibold text-[var(--on-surface)] hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-[16px]">task_alt</span>
                  {t('ws.markComplete')}
                </button>
              )}
            </div>
          )}

          <NextActionBar
            action={nextStep}
            go={{ phase: go.phase, pendingStep: Boolean(go.pendingStep), authorizing: Boolean(go.authorizing), error: go.error }}
            onAct={async (a) => {
              if (a.kind === 'apply_continue_reopened' || a.kind === 'apply_continue') await continueWork();
              else if (a.kind === 'resume') await go.go();
              else if (a.kind === 'answer_go') showGo();
            }}
            onShowGo={showGo}
          />

          {/* FR-20. Above the stage header rather than inside it: exporting is
              a property of the project, not of whichever stage happens to be
              open, and burying it in a stage would make it look like one. */}
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <ProjectTimeline
              template={template}
              events={events ?? []}
              stages={stageBundles}
              onOpen={(id, versionId) => {
                const target = id === state.current_stage_id ? null : id;
                if (target === viewingStageId) setActiveVersionId(versionId);
                else {
                  openVersionRef.current = versionId;
                  setViewingStageId(target);
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
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
            stage={{
              ...stage,
              label: inFormWords(stageText(locale, template.key, stage, 'label'), workForm),
              entry_guidance: inFormWords(stageText(locale, template.key, stage, 'guidance'), workForm),
              // Why each mode suits the stage, in the interface's language (client, 21 Oct).
              recommended_modes: stage.recommended_modes.map((r) => ({ ...r, reason: shownModeReason(template.key, stage.id, r.mode, r.reason) })),
            }}
            status={state.stages[stage.id]?.status ?? 'not_started'}
            skippedReason={state.stages[stage.id]?.skipped_reason}
            position={{ index: stageIndex + 1, total: template.stages.length }}
            // Picking a mode is the user's override: it is used on every stage (13 Oct).
            onPickMode={isCurrent ? (mode) => onPatchProject({ mode: mode as Project['mode'], stage_modes: 'project' }) : undefined}
            currentMode={modeForStage(project, stage)}
            leftOpen={Boolean(state.stages[stage.id]?.left_open)}
            isCurrent={isCurrent}
            approvalPending={approvalPendingIds.has(stage.id)}
            hasDraft={Boolean(context.artifactNonEmpty[stage.id])}
          />
          <WebFoundNotice projectId={project.id} stageId={stage.id} />

          {isCurrent && appendStageVersion && project.status !== 'finalized' && (
            <GoPanel
              go={go}
              stageLabel={stageNameShown(stage.id)}
              stageName={(id) => stageNameShown(id, 'short')}
              stageByEnglish={shownStageByEnglish}
              mode={project.mode}
              stageMode={stage?.recommended_modes?.[0]?.mode}
              needsActions={goNeedsActions}
              needContext={goNeedContextOnPage}
              dockHost={goDockHost}
              routine={{ value: project.routine_decisions ?? 'ask', onChange: (v) => void setRoutineDecisions(v) }}
              stageModes={{ value: project.stage_modes ?? 'stage', onChange: (v) => onPatchProject({ stage_modes: v }) }}
              latestChange={goLatestChange}
              onApplyAnyway={applyAnyway}
            />
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
                      if (!kept) throw new Error(tr('wserr.notKept'));
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
            {objectiveAssessment && project.status !== 'finalized' && (
              <div className="mb-4">
                <ObjectivePausedNotice
                  assessment={objectiveAssessment}
                  // One action for one pause: when Go is waiting on this check,
                  // the button is the Go panel's own (17 Oct, FIELDGUIDE).
                  onResume={
                    !appendStageVersion
                      ? undefined
                      : objectiveNeed?.finding === 'unmet'
                        ? () => void go.fixObjective(objectiveNeed.items)
                        : () => void go.go()
                  }
                  resumeLabel={objectiveNeed ? (describeNeed(objectiveNeed, (id) => stageNameShown(id, 'short'), {}, locale).action ?? undefined) : undefined}
                  resumeDisabled={go.active}
                  onAnswer={
                    appendStageVersion && go.run && !go.run.ended_at && go.run.status === 'awaiting_decision' && go.run.needs?.kind === 'answer_question'
                      ? (text) => go.answer(text)
                      : undefined
                  }
                />
              </div>
            )}
            <PendingChangeNotice
              changes={project.status === 'finalized' ? [] : heldChanges.filter((c) => c.id !== pendingShown)}
              stageLabel={(id) => { const s = template.stages.find((x) => x.id === id); return s ? stageText(locale, template.key, s, 'label') : id; }}
              onChoose={(c) => {
                setViewingStageId(c.stageId === state.current_stage_id ? null : c.stageId);
                setChatOpen(true);
                setResumeChange(c);
              }}
              onDiscard={(c) => void settlePendingChange(c.id, 'withdrawn').then(upsertRecommendation, () => undefined)}
            />
            <BriefChangeNotice
              change={briefChange}
              stageLabel={(id) => { const s = template.stages.find((x) => x.id === id); return s ? stageText(locale, template.key, s, 'label') : id; }}
              onKeep={(changeAt) => void appendEvent({ type: 'brief_change_dismissed', stage_id: stageId, payload: { change_at: changeAt } })}
              // The button is the next-step bar's, at the top of every stage.
              onUpdate={undefined}
              updating={go.active}
              judging={judgingChange}
              settled={settled}
              onDismissSettled={() => settled && setSettledDismissed(settled.event.created_at)}
            />
            {factReconcile && factReconcile.stageId === stage.id && (
              <FactReconcileNotice
                project={project}
                stageLabel={stage.label}
                stageTitle={stageNameShown(stage.id)}
                how={factReconcile.how}
                changes={factReconcile.changes}
                onChanged={() => onReload?.()}
                onDone={() => setFactReconcile(null)}
              />
            )}
            <FiguresOnRecord template={template} state={state} bundles={stageBundles} />
            {/* On every stage: the accepted facts are the project's record (F3, 7 Oct). */}
            <ProjectFacts project={project} onChanged={() => onReload?.()} readOnly={!isEditable || project.status === 'finalized'} />
            {/* On every stage: the other projects this one draws on (client, 21 Oct, email 5). */}
            <ProjectReferences project={project} readOnly={!isEditable || project.status === 'finalized'} onOpenBeside={openBeside} />
            {/* On every stage: the switch and the sources every stage cites (20 Oct). */}
            <WebSources
              project={project}
              stageId={stage.id}
              onToggle={setWebAccess}
              onChanged={() => onReload?.()}
              readOnly={!isEditable || project.status === 'finalized'}
            />
            {/* On every stage: data is the project's, not a stage's. */}
            <ProjectData
              project={project}
              files={project.data_files ?? []}
              onChanged={() => onReload?.()}
              onAddToContext={(documents) =>
                onPatchProject({ context: contextFromDocuments(project.context ?? '', documents, INPUT_LIMITS.context).context })
              }
              readOnly={project.status === 'finalized'}
            />

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
            <RefusedRevisions refused={refusedSince(events ?? [], stage.id, headVersion)} head={headVersion} />
            {showFinishedHint && canReopen && (
              <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-container-high)] px-4 py-2.5">
                <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]" aria-hidden>lock</span>
                <span className="text-label text-[var(--on-surface)]">
                  {t('ws.finishedHint')}
                </span>
                <button
                  onClick={() => void reopenStage()}
                  className="rounded-lg bg-[var(--pm-primary)] px-3 py-1 text-label font-semibold text-[var(--on-primary)] hover:opacity-90"
                >
                  {t('ws.editStage')}
                </button>
              </div>
            )}
            {explicitOutlineHere ? null : !stageDrafts(stage) &&
              stage.renderer !== 'long_form' ? (
              <CheckpointPanel />
            ) : (
              <div
                onPointerDownCapture={canReopen ? () => setFinishedHint(stageId) : undefined}
                onKeyDownCapture={canReopen ? () => setFinishedHint(stageId) : undefined}
              >
              <StageRenderer
                templateKey={template.key}
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
                onProposeStatuses={(itemSchemaFor(stage).statuses ?? []).some((s) => s.modelMayPropose) ? proposeItems : undefined}
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
                canConfirmWhenReadOnly={isDone(viewedState?.status) && project.status !== 'finalized'}
                evaluation={
                  evaluations?.[
                    activeVersionId ?? stageVersions.at(-1)?.id ?? ''
                  ]
                }
                longForm={longFormContext}
              />
              </div>
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

          {/* A critique ends in a few actions, like a chat answer (2 Oct, item 6);
              its points are still there one by one, behind a disclosure. */}
          {isCurrent && draftable && tools.commentary && (
            <div className="mb-6">
              <CritiqueFollowUp
                key={`${tools.commentary.title}:${tools.commentary.text}`}
                commentary={tools.commentary}
                points={critiquePoints}
                busy={applyFindings.running}
                suggest={suggestReplyActions}
                previewRows={previewReplyRows}
                onRun={(action) => runReplyAction(action, tools.commentary!.title)}
                onApplyPoints={(ids, showFirst) =>
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
              committedByPolicy={committedByPolicy}
              approvedVersions={approvedVersions(stageBundles[stageId]?.versions ?? [], project.manual_check_versions)}
              onToggleManual={(id, checked) => void handleToggleManual(id, checked)}
              readOnly={!isEditable}
              collapsible={foldStageExtras}
              onFinish={finishHere ? () => setFinishing({ option: finishHere }) : undefined}
            />

            <RecommendationsPanel
              stageLabel={stageNameShown(stage.id, 'short')}
              names={{
                stage: (id) => stageNameShown(id),
                guidance: (id) => {
                  const s = template.stages.find((x) => x.id === id);
                  const g = s?.entry_guidance ? stageText(locale, template.key, s, 'guidance') : '';
                  return g ? g.split('. ')[0] : '';
                },
                elsewhere: outstandingOtherShown,
                templateKey: template.key,
              }}
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
            {foldStageExtras ? (
              (showDials || shownEvaluation) && (
                <details data-stage-extras className="rounded-xl bg-[var(--surface-container-low)] px-5 py-3">
                  <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">
                    {shownEvaluation ? t('ws.checkAndDials') : t('ws.dials')}
                  </summary>
                  <div className="mt-3 space-y-4">
                    {showDials && dials}
                    <StageEvaluationPanel evaluation={shownEvaluation} />
                  </div>
                </details>
              )
            ) : (
              <>
                {showDials && dials}
                <StageEvaluationPanel evaluation={shownEvaluation} />
              </>
            )}

            {/* PM-22: the easy actions after a check, on the version it checked. */}
            {isCurrent && draftable && headVersion && (evaluations?.[headVersion.id]?.findings ?? []).length > 0 && (
              <CritiqueActions
                title={t('ws.actOnCheck')}
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
              <p role="status" className="text-label text-[var(--on-surface-variant)]">{t('ws.applying')}</p>
            )}
            {applyFindings.error && (
              <div role="alert" className="flex items-start gap-3 rounded-xl bg-[var(--error-container)] px-5 py-3">
                <p className="flex-1 text-body text-[var(--on-error-container)]">{applyFindings.error}</p>
                <button onClick={applyFindings.dismissError} className="text-label text-[var(--on-error-container)] underline">{t('ws.dismiss')}</button>
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
                leftOpen={completion.leftOpenStages.map((s) => ({ id: s.id, label: stageNameShown(s.id, 'short') }))}
                onViewStage={setViewingStageId}
              />
            )}
            {isCurrent && isBlocked && stageState?.blocked && !goHoldsThisBlock && (
              <BlockedNotice kind={stageState.blocked.kind} reason={stageState.blocked.reason} onUnblock={() => void setBlocked(null)} />
            )}
            {isCurrent && blocking && (
              <BlockForm onSubmit={(block) => void setBlocked(block)} onCancel={() => setBlocking(false)} />
            )}
            {isCurrent && finishing && (
              <CompletionDialog
                summary={completion}
                show={outstandingShow}
                busy={busy}
                check={objectiveCheck}
                onCheck={() => void checkAgainstObjective()}
                onConfirm={(reason) => {
                  const { option, note } = finishing;
                  setFinishing(null);
                  // Finishing past open work is a deviation, so its reason is
                  // recorded on project_finalized with what was still open.
                  const why = reason
                    ? [note, `Finished with ${completion.outstanding.length} item(s) still open: ${completion.outstanding.map(describeOutstanding).join('; ')}. Reason: ${reason}`]
                        .filter(Boolean)
                        .join(' — ')
                    : note;
                  void handleTransition(option, why);
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
                label={go.stepLabel(go.pendingStep)}
                effect={go.stepEffect(go.pendingStep)}
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
                // A check that failed says so here, beside the button pressed:
                // a long-form stage had nowhere to show it (14 Oct).
                error={transitionError ?? (stageEvaluation.error ? t('wsa.checkNotFinished', { error: stageEvaluation.error }) : null)}
                primary={primaryAction}
                onPrimary={runPrimary}
                more={moreActions}
                nextStageLabel={nextStage ? stageText(locale, template.key, nextStage, 'short') : null}
                stageName={shownStageName}
                // Go waiting for an answer is open work too (6 Oct, email 1:
                // "nothing was outstanding while … Go was waiting for me").
                elsewhere={goWaiting ? [...outstandingOtherShown, t('wsa.goWaitingFor', { what: shownGoWaitingLine(goWaiting) })] : outstandingOtherShown}
                working={
                  stageEvaluation.evaluating ? t('wsa.checking')
                    : generation.generating ? t('wsa.drafting')
                      : tools.running !== null ? t('na.working')
                        : go.active ? t('wsa.goWorking')
                          : null
                }
                done={stageEvaluation.checked && stageEvaluation.checked === headVersion?.id ? t('wsa.checked') : null}
                projectOpen={projectOpenOn === stage.id}
                checkSays={currentCheckSays}
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
          className={`fixed inset-0 z-40 flex flex-col bg-[var(--surface)] p-4 lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-[100dvh] lg:max-h-[100dvh] lg:w-[380px] lg:shrink-0 lg:self-start lg:bg-transparent lg:py-6 lg:ps-0 lg:pe-6 ${readingTab ? 'xl:w-[480px]' : ''}`}
        >
          <button
            onClick={() => setChatOpen(false)}
            className="mb-2 ms-auto flex items-center gap-1 rounded-lg px-2 py-1 text-label text-[var(--on-surface-variant)] lg:hidden"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">
              close
            </span>
            {t('ws.close')}
          </button>

          {/* Two tabs in one slot when another project is open beside: the
              chat stays mounted under the reader, so its draft and thread
              survive a look at the other project. */}
          {reader.open && roomBeside && (
            <div role="tablist" aria-label={t('ws.beside')} className="mb-2 hidden gap-1 md:flex">
              <button
                type="button"
                role="tab"
                aria-selected={!readingTab}
                onClick={() => setReader({ ...reader, tab: 'chat' })}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label ${!readingTab ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'}`}
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">forum</span>
                {t('ws.sideChat')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readingTab}
                onClick={() => setReader({ ...reader, tab: 'reader' })}
                className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-label ${readingTab ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'}`}
              >
                <span aria-hidden className="material-symbols-outlined text-[16px]">menu_book</span>
                <span className="truncate">{t('ws.reading')}</span>
              </button>
            </div>
          )}
          {reader.open && roomBeside && (
            <div data-testid="reader-slot" className={readingTab ? 'min-h-0 flex-1' : 'hidden'}>
              <ProjectReaderPane
                currentProjectId={project.id}
                readingId={reader.id}
                onChoose={(id) => setReader({ id, open: true, tab: 'reader' })}
                onClose={() => setReader({ id: null, open: false, tab: 'chat' })}
                onSendToChat={(text) => {
                  setChatPrefill({ text, nonce: Date.now() });
                  setReader({ ...reader, tab: 'chat' });
                }}
                onUseAsReference={
                  project.status === 'finalized'
                    ? undefined
                    : async (id) => {
                        await addReference(project.user_id, project.id, id);
                        await reloadReferences();
                      }
                }
                referenced={Boolean(reader.id && referenceRows.some((r) => r.referenced_project_id === reader.id))}
                referencesFull={referenceRows.length >= MAX_REFERENCES}
              />
            </div>
          )}
          <div data-testid="chat-slot" className={readingTab ? 'hidden' : 'min-h-0 flex-1'}>
            <ChatPanel
              project={project}
              stageId={stage.id}
              stageLabel={stage.label}
              stageTitle={stageText(locale, template.key, stage, 'label')}
              onFactsChanged={() => onReload?.()}
              onSourcesChanged={() => onReload?.()}
              // 13 Oct (Sean, email 6): the revision's saved text is checked
              // against what can be measured, and the result shown with it.
              checkRevision={(text) => measureStageContent(project, template, stage, text).map((m) => ({ label: `${m.label} — ${m.value ?? (m.satisfied ? 'met' : 'not met')}`, ok: m.satisfied }))}
              autoApply={project.routine_decisions === 'handle'}
              awaitingUpdate={awaitingLabels.filter((l) => l !== stage.label)}
              attach={
                project.status === 'finalized' ? undefined : (
                  <ChatAttach
                    project={project}
                    existingNames={(project.data_files ?? []).map((f) => f.name)}
                    onChanged={() => onReload?.()}
                    onAddToContext={(documents) =>
                      onPatchProject({ context: contextFromDocuments(project.context ?? '', documents, INPUT_LIMITS.context).context })
                    }
                    disabled={!isEditable}
                  />
                )
              }
              content={chatContentFor(
                template,
                stage,
                stageBundles,
                (activeVersionId
                  ? stageVersions.find((v) => v.id === activeVersionId)?.content
                  : undefined) ??
                  stageVersions.at(-1)?.content ??
                  ''
              )}
              // Built when a message is sent, not on every render: it carries the chapters.
              getChatContext={() =>
                buildChatContext({
                  template, state, project, stage, bundles: stageBundles, controls: pageControls,
                  display: { stageName: (s) => stageText(locale, template.key, s, 'label'), workflowName: shownTemplateName },
                  goRun: {
                    run: go.run ? { status: go.run.status, policy: go.run.policy, stop_reason: go.run.stop_reason ?? null } : null,
                    steps: go.steps,
                    objective: objectiveAssessment
                      ? `${objectiveAssessment.outcome.replace('_', ' ')} — ${objectiveAssessment.reason}${objectiveAssessment.blockers.length ? ` Waiting for: ${objectiveAssessment.blockers.map((b) => b.need).join('; ')}.` : ''}`
                      : '',
                  },
                })
              }
              starters={isCurrent ? starterQuestions({
                renderer: stage.renderer,
                stageLabel: stageText(locale, template.key, stage, 'short'),
                hasContent: hasContent || (stage.renderer === 'long_form' && (stageBundles[draftingStageId(template) ?? '']?.artifact?.long_form?.outline ?? []).some((sec) => (sec.content ?? '').trim())),
                openRows: rendererHoldsItems(stage.renderer) ? headItems.filter((i) => !isTriaged(i, itemSchemaFor(stage))).length : 0,
                requiredOpen: evaluation.criteria.filter((c) => c.blocking && !c.satisfied).map((c) => templateWord(locale, c.label)),
                nextStageLabel: nextStage ? stageText(locale, template.key, nextStage, 'short') : null,
              }, locale === 'en' ? undefined : (key, vars) => translate(locale, key, vars)) : []}
              headVersion={stageVersions.at(-1) ?? null}
              appendStageVersion={appendStageVersion}
              restoreStageVersion={restoreStageVersion}
              readOnly={!isEditable}
              // Revising splices into the content it was handed, so instructing
              // while reading an older version would append a version built
              // from it and lose everything since. Discussion is unaffected.
              // The chat sees an outline or the chapters as readable text, so
              // it cannot splice into them: they change in their own editors.
              canInstruct={
                (activeVersionId === null || activeVersionId === stageVersions.at(-1)?.id) && chatEditsProse
              }
              cannotChangeBecause={
                rendererHoldsItems(stage.renderer)
                  ? t('ws.askRows')
                  : stage.renderer === 'outline'
                    ? t('ws.askOutline')
                    : stage.renderer === 'long_form'
                      ? t('ws.askChapter')
                      : undefined
              }
              isTable={!chatEditsProse}
              editElsewhere={editElsewhere}
              suggestActions={draftable && headVersion ? suggestReplyActions : undefined}
              previewRows={previewReplyRows}
              onRunAction={runReplyAction}
              isActionDone={(action) => factsAlreadyRecorded(action, project.facts)}
              afterActionDone={
                <FactsNextStep
                  judging={judgingChange}
                  waiting={[...(briefChange?.stageIds ?? []), ...(briefChange?.alsoWaiting ?? [])].map((id) => template.stages.find((s) => s.id === id)?.label ?? id)}
                  onUpdate={appendStageVersion && project.status !== 'finalized' ? () => void continueWork() : undefined}
                  updating={go.active}
                  updated={settledChange(events ?? [], state, Date.now())?.stageIds.map((id) => template.stages.find((s) => s.id === id)?.label ?? id)}
                />
              }
              applying={applyFindings.running}
              resumeChange={resumeChange}
              onResumeTaken={takeResume}
              prefill={chatPrefill}
              onPrefillTaken={takePrefill}
              onPendingShown={setPendingShown}
            />
          </div>
        </aside>
      )}
    </div>
  );
}
