'use client';

import { create } from 'zustand';

import {
  getProject,
  updateProject,
} from '@/lib/supabase/projects';
import {
  appendVersion as appendVersionRow,
  createArtifact,
  getEvaluation,
  listArtifacts,
  listVersions,
  rateVersion as rateVersionRow,
  restoreVersion as restoreVersionRow,
  saveArtifactSummary,
  saveEvaluation,
  type NewEvaluation,
  type NewVersion,
} from '@/lib/supabase/versions';
import { OUTLINE_ARTIFACT_KIND } from '@/lib/supabase/outline';
import { listRecommendations, type Recommendation } from '@/lib/supabase/recommendations';
import { listTasks, type ProjectTask } from '@/lib/supabase/tasks';
import {
  appendWorkflowEvent,
  listWorkflowEvents,
  type NewWorkflowEvent,
} from '@/lib/supabase/workflow';
import type { WorkflowEvent } from '@/lib/workflow/types';
import {
  ProjectConflictError,
  type Artifact,
  type ArtifactVersion,
  type Evaluation,
  type Project,
  type ProjectPatch,
} from '@/types/project';

/**
 * The open project.
 *
 * Built as a new store rather than an extension of the legacy session store,
 * which was ~450 lines of flat session fields that both flows would have had
 * to carry. That store is gone now, along with the flow it drove; this is the
 * only one left.
 *
 * One store instance holding one project, not a map of projects. The UI shows
 * one project at a time, and multi-project concurrency comes free from browser
 * tabs — a store-per-project design would buy a React context and a hook
 * threaded through every consumer for no user-visible gain.
 */

const DEBOUNCE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

/** One stage's artifact and its whole version history. */
export interface StageBundle {
  artifact: Artifact | null;
  versions: ArtifactVersion[];
}

interface ProjectState {
  projectId: string | null;
  project: Project | null;
  artifact: Artifact | null;
  versions: ArtifactVersion[];
  /**
   * Every stage's artifact, keyed by stage id.
   *
   * `artifact`/`versions` above remain the single-output project's pane and
   * the legacy /session path; this map is what a thirteen-stage Book reads.
   * Both point at the same rows — a stage bundle is not a copy.
   */
  stages: Record<string, StageBundle>;
  evaluations: Record<string, Evaluation>;

  /**
   * The workflow event log — the record stage state is projected from — and
   * the recommendations and tasks, loaded with the project and re-read here.
   *
   * These used to be fetched by the workspace and its hooks, each on its own
   * schedule: events in a `useState` with seven ad-hoc reloads, recommendations
   * once per project. Surfaces then disagreed about what had happened (Sean,
   * 28 Sep: "the individual components … do not always seem to know what the
   * other components have already done"). One row set, one place to refresh.
   *
   * `events` is null until the first load, so a consumer can tell "no events"
   * from "not read yet" and not generate against an empty log.
   */
  events: WorkflowEvent[] | null;
  recommendations: Recommendation[];
  tasks: ProjectTask[];

  /** Which version the UI is *displaying*. Never implies a restore. */
  activeVersionId: string | null;

  loading: boolean;
  error: string | null;

  /** A boolean cannot express "conflict", and FR-21 requires the user to see one. */
  saveState: SaveState;
  conflict: { serverProject: Project | null; localPatch: ProjectPatch } | null;

  /**
   * `background: true` re-reads the project in place: no skeleton, and edits
   * still waiting on the debounce are kept and re-applied over what loads.
   * The workspace reloads after approvals and after each drafted section; a
   * foreground reload there swapped the whole page for the loading skeleton —
   * header and footer vanished, scroll, chat and the stage being viewed all
   * reset — and silently dropped any edit typed in the last 800ms (Sean's
   * "see very top and bottom after I press save").
   */
  loadProject: (id: string, options?: { background?: boolean }) => Promise<void>;
  closeProject: () => void;

  /** Optimistic local edit, flushed after a debounce. */
  patchProject: (patch: ProjectPatch) => void;
  /** Force the pending patch out now (tab hide, navigation, sign-out). */
  flush: () => Promise<void>;

  appendVersion: (version: NewVersion, evaluation?: NewEvaluation) => Promise<ArtifactVersion>;
  restoreVersion: (versionId: string) => Promise<void>;

  /** Create this stage's artifact if it has none yet. Idempotent. */
  ensureStageArtifact: (stageId: string, name: string) => Promise<Artifact>;
  /**
   * Append a version to a specific stage's artifact, creating it if needed.
   *
   * The optional evaluation mirrors `appendVersion` — a caller that produced
   * content and its scores in one operation writes both here, rather than
   * appending and then discovering there is no seam to attach scores through.
   */
  appendStageVersion: (
    stageId: string,
    name: string,
    version: NewVersion,
    evaluation?: NewEvaluation
  ) => Promise<ArtifactVersion>;
  restoreStageVersion: (stageId: string, versionId: string) => Promise<void>;

  /**
   * Append a workflow event and re-read the log, so every consumer sees the
   * same record the database holds (including anything the server wrote in
   * the meantime — drafted sections, Go mode's moves). Returns the fresh log.
   */
  appendEvent: (event: NewWorkflowEvent) => Promise<WorkflowEvent[]>;
  /** Re-read the event log without writing. Returns the fresh log. */
  refreshEvents: () => Promise<WorkflowEvent[]>;
  /** Re-read everything in place — the background reload, by its real name. */
  refresh: () => Promise<void>;
  reloadRecommendations: () => Promise<void>;
  /** Reflect a row just written or resolved without a round trip. */
  upsertRecommendation: (row: Recommendation) => void;
  upsertTask: (task: ProjectTask) => void;

  /**
   * Attach an evaluation to a stage version that already exists.
   *
   * Evaluating is not editing: the content is unchanged, so it must not append
   * a version. `artifact_versions` is append-only content history, and a
   * version whose only difference from its parent is that someone pressed
   * Evaluate would be noise in every history view forever.
   */
  recordStageEvaluation: (
    stageId: string,
    versionId: string,
    evaluation: NewEvaluation
  ) => Promise<Evaluation>;
  /** Record what a stage concluded, for the digest later stages generate against. */
  setStageSummary: (stageId: string, summary: string) => Promise<void>;

  rateVersion: (versionId: string, rating: 'positive' | 'negative' | null) => Promise<void>;
  setActiveVersion: (versionId: string | null) => void;

  resolveConflict: (choice: 'reload' | 'keep-mine') => Promise<void>;
}

// Module-level rather than store state: a timer and an in-flight patch are
// machinery, not something a component should re-render on.
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: ProjectPatch = {};
// The flush currently talking to the server. A second flush waits for it
// rather than racing it: two requests carrying the same starting revision make
// the second one a conflict with the first, and the user saw "This project was
// changed in another tab" with only one tab open.
let inFlight: Promise<void> | null = null;

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projectId: null,
  project: null,
  artifact: null,
  versions: [],
  stages: {},
  evaluations: {},
  events: null,
  recommendations: [],
  tasks: [],
  activeVersionId: null,
  loading: false,
  error: null,
  saveState: 'idle',
  conflict: null,

  async loadProject(id, options) {
    const background = Boolean(options?.background) && get().projectId === id && get().project !== null;
    if (background) {
      // Let an in-progress save land first, so what loads includes it.
      if (inFlight) await inFlight.catch(() => undefined);
    } else {
      clearTimer();
      pendingPatch = {};
      set({ loading: true, error: null, projectId: id, saveState: 'idle', conflict: null });
    }

    try {
      const project = await getProject(id);
      if (!project) {
        set({ loading: false, error: 'Project not found.', project: null });
        return;
      }

      // A missing recommendations or tasks row set must not take the project
      // down: the derived half of the panel still works. Events fail closed to
      // an empty log, as the workspace's own loader did.
      const [artifacts, events, recommendations, tasks] = await Promise.all([
        listArtifacts(id),
        listWorkflowEvents(id).catch(() => [] as WorkflowEvent[]),
        listRecommendations(id).catch(() => [] as Recommendation[]),
        listTasks(id).catch(() => [] as ProjectTask[]),
      ]);

      // A Book project has thirteen artifacts, not one. Load them all and index
      // by stage; picking `kind === 'output'` could only ever describe a
      // single-output project, which is the shape this replaces.
      const stages: Record<string, StageBundle> = {};
      const allVersions = await Promise.all(
        artifacts.map(async (a) => ({ artifact: a, versions: await listVersions(a.id) }))
      );
      for (const bundle of allVersions) {
        const stageId = bundle.artifact.stage_id;
        if (!stageId) continue;
        // A derived-outline workflow puts TWO artifacts on its drafting stage:
        // the outline it approves, and the paper it writes. The outline is a
        // companion to the stage rather than its output, so it never claims the
        // bundle — letting it win would make the drafting renderer read an
        // outline as its manuscript and every exit criterion answer about the
        // wrong row.
        const held = stages[stageId];
        if (held && bundle.artifact.kind === OUTLINE_ARTIFACT_KIND) continue;
        if (held && held.artifact?.kind !== OUTLINE_ARTIFACT_KIND) continue;
        stages[stageId] = bundle;
      }

      const artifact = artifacts.find((a) => a.kind === 'output') ?? artifacts[0] ?? null;
      const versions = allVersions.find((b) => b.artifact.id === artifact?.id)?.versions ?? [];

      const evaluations: Record<string, Evaluation> = {};
      // Only head versions' evaluations are needed to render; the rest load
      // lazily when the user opens version history.
      //
      // Every stage's head, not just the project artifact's. The 65 imported
      // projects carry 128 evaluation rows against stage artifacts, and loading
      // only the project-level one left every score invisible on exactly the
      // projects that have them.
      const heads = new Set<string>();
      const projectHead = versions[versions.length - 1];
      if (projectHead) heads.add(projectHead.id);
      for (const bundle of Object.values(stages)) {
        const head = bundle.versions[bundle.versions.length - 1];
        if (head) heads.add(head.id);
      }

      // In parallel: this is one round trip per stage, and a thirteen-stage
      // Book would otherwise serialise thirteen of them behind each other.
      const loaded = await Promise.all(
        [...heads].map(async (id) => [id, await getEvaluation(id)] as const)
      );
      for (const [id, evaluation] of loaded) {
        if (evaluation) evaluations[id] = evaluation;
      }
      const head = projectHead;

      set({
        // Unsaved local edits stay on screen over the freshly loaded row; the
        // pending flush will send them with the new revision.
        project: background ? { ...project, ...pendingPatch } : project,
        artifact,
        versions,
        stages,
        evaluations,
        events,
        recommendations,
        tasks,
        activeVersionId: head?.id ?? null,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load project.' });
    }
  },

  closeProject() {
    clearTimer();
    pendingPatch = {};
    set({
      projectId: null,
      project: null,
      artifact: null,
      versions: [],
      stages: {},
      evaluations: {},
      events: null,
      recommendations: [],
      tasks: [],
      activeVersionId: null,
      saveState: 'idle',
      conflict: null,
      error: null,
    });
  },

  async appendEvent(event) {
    const { project } = get();
    if (!project) throw new Error('No project open.');
    await appendWorkflowEvent(project.id, project.user_id, event);
    return get().refreshEvents();
  },

  async refreshEvents() {
    const { projectId } = get();
    if (!projectId) return [];
    const events = await listWorkflowEvents(projectId);
    // Only if the same project is still open: a reload that lands after the
    // user has moved on must not file one project's log under another.
    if (get().projectId === projectId) set({ events });
    return events;
  },

  async refresh() {
    const { projectId } = get();
    if (projectId) await get().loadProject(projectId, { background: true });
  },

  async reloadRecommendations() {
    const { projectId } = get();
    if (!projectId) return;
    const [recommendations, tasks] = await Promise.all([listRecommendations(projectId), listTasks(projectId)]);
    if (get().projectId === projectId) set({ recommendations, tasks });
  },

  upsertRecommendation(row) {
    set((s) => ({
      recommendations: s.recommendations.some((r) => r.id === row.id)
        ? s.recommendations.map((r) => (r.id === row.id ? row : r))
        : [...s.recommendations, row],
    }));
  },

  upsertTask(task) {
    set((s) => ({
      tasks: s.tasks.some((t) => t.id === task.id)
        ? s.tasks.map((t) => (t.id === task.id ? task : t))
        : [...s.tasks, task],
    }));
  },

  patchProject(patch) {
    const { project } = get();
    if (!project) return;

    // Optimistic locally so typing stays responsive; the flush reconciles.
    set({ project: { ...project, ...patch }, saveState: 'saving' });
    // Accumulate field patches rather than whole snapshots — sending the whole
    // object on a debounce is a lost-update generator when two fields are
    // edited in different tabs.
    pendingPatch = { ...pendingPatch, ...patch };

    clearTimer();
    timer = setTimeout(() => void get().flush(), DEBOUNCE_MS);
  },

  async flush() {
    clearTimer();
    // Serialise: wait for the save already on the wire, then send what has
    // accumulated since, against the revision that save produced.
    while (inFlight) await inFlight.catch(() => undefined);

    const { project } = get();
    const patch = pendingPatch;
    if (!project || Object.keys(patch).length === 0) return;

    pendingPatch = {};
    const request = updateProject(project.id, patch, project.revision);
    inFlight = request.then(
      () => undefined,
      () => undefined
    );
    try {
      const updated = await request;
      // Characters typed while the request was out are still in pendingPatch;
      // replacing the project with the server row alone made the text jump back.
      set({ project: { ...updated, ...pendingPatch }, saveState: 'saved' });
      if (Object.keys(pendingPatch).length > 0) set({ saveState: 'saving' });
    } catch (err) {
      if (err instanceof ProjectConflictError) {
        // Never resolve automatically: the local edit is what the user just
        // typed, and the server copy is someone else's work.
        set({
          saveState: 'conflict',
          conflict: { serverProject: err.current, localPatch: patch },
        });
        return;
      }
      // Keep the patch so the next flush retries it rather than dropping the edit.
      pendingPatch = { ...patch, ...pendingPatch };
      set({ saveState: 'error', error: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      inFlight = null;
    }
  },

  async appendVersion(version, evaluation) {
    const { artifact } = get();
    if (!artifact) throw new Error('No artifact open.');

    // Write before touching local state: a failed write must not leave the UI
    // showing a version that does not exist.
    const created = await appendVersionRow(artifact, version);

    let saved: Evaluation | null = null;
    if (evaluation) saved = await saveEvaluation(created, evaluation);

    set((s) => ({
      artifact: {
        ...artifact,
        current_version_id: created.id,
        version_count: created.version_number,
        revision: artifact.revision + 1,
      },
      versions: [...s.versions, created],
      activeVersionId: created.id,
      evaluations: saved ? { ...s.evaluations, [created.id]: saved } : s.evaluations,
    }));

    return created;
  },

  async ensureStageArtifact(stageId, name) {
    const { stages, project } = get();
    const existing = stages[stageId]?.artifact;
    if (existing) return existing;
    if (!project) throw new Error('No project open.');

    const created = await createArtifact(project.id, project.user_id, 'output', name, stageId);
    set((s) => ({ stages: { ...s.stages, [stageId]: { artifact: created, versions: [] } } }));
    return created;
  },

  async appendStageVersion(stageId, name, version, evaluation) {
    const artifact = await get().ensureStageArtifact(stageId, name);
    // Read the artifact back out of the store rather than reusing the one
    // above: version_count and revision move with every append, and a stale
    // copy would write version 2 twice.
    const current = get().stages[stageId]?.artifact ?? artifact;
    const created = await appendVersionRow(current, version);

    let saved: Evaluation | null = null;
    if (evaluation) saved = await saveEvaluation(created, evaluation);

    set((s) => {
      const bundle = s.stages[stageId] ?? { artifact: current, versions: [] };
      return {
        stages: {
          ...s.stages,
          [stageId]: {
            artifact: {
              ...current,
              current_version_id: created.id,
              version_count: created.version_number,
              revision: current.revision + 1,
            },
            versions: [...bundle.versions, created],
          },
        },
        evaluations: saved ? { ...s.evaluations, [created.id]: saved } : s.evaluations,
      };
    });

    return created;
  },

  async recordStageEvaluation(stageId, versionId, evaluation) {
    const bundle = get().stages[stageId];
    const version = bundle?.versions.find((v) => v.id === versionId);
    if (!version) throw new Error('That version is no longer open.');

    const saved = await saveEvaluation(version, evaluation);
    set((s) => ({ evaluations: { ...s.evaluations, [versionId]: saved } }));
    return saved;
  },

  async restoreStageVersion(stageId, versionId) {
    const bundle = get().stages[stageId];
    const target = bundle?.versions.find((v) => v.id === versionId);
    if (!bundle?.artifact || !target) throw new Error('Version not found.');

    // Restore appends rather than mutating, so restoring is itself undoable.
    const created = await restoreVersionRow(bundle.artifact, target);
    set((s) => ({
      stages: {
        ...s.stages,
        [stageId]: {
          artifact: {
            ...bundle.artifact!,
            current_version_id: created.id,
            version_count: created.version_number,
            revision: bundle.artifact!.revision + 1,
          },
          versions: [...bundle.versions, created],
        },
      },
    }));
  },

  async setStageSummary(stageId, summary) {
    const bundle = get().stages[stageId];
    if (!bundle?.artifact) return;
    if ((bundle.artifact.summary ?? '') === summary) return;

    await saveArtifactSummary(bundle.artifact.id, summary);
    set((s) => {
      const current = s.stages[stageId];
      if (!current?.artifact) return {};
      return {
        stages: {
          ...s.stages,
          [stageId]: { ...current, artifact: { ...current.artifact, summary } },
        },
      };
    });
  },

  async restoreVersion(versionId) {
    const { artifact, versions } = get();
    const target = versions.find((v) => v.id === versionId);
    if (!artifact || !target) throw new Error('Version not found.');

    const created = await restoreVersionRow(artifact, target);
    const evaluation = await getEvaluation(created.id);

    set((s) => ({
      artifact: {
        ...artifact,
        current_version_id: created.id,
        version_count: created.version_number,
        revision: artifact.revision + 1,
      },
      versions: [...s.versions, created],
      activeVersionId: created.id,
      evaluations: evaluation ? { ...s.evaluations, [created.id]: evaluation } : s.evaluations,
    }));
  },

  async rateVersion(versionId, rating) {
    await rateVersionRow(versionId, rating);
    set((s) => ({
      versions: s.versions.map((v) => (v.id === versionId ? { ...v, user_rating: rating } : v)),
    }));
  },

  setActiveVersion(versionId) {
    // Viewing only. Restoring is a separate, explicit action that appends —
    // conflating them would make browsing history mutate the project.
    set({ activeVersionId: versionId });
  },

  async resolveConflict(choice) {
    const { conflict, projectId } = get();
    if (!conflict || !projectId) return;

    if (choice === 'reload') {
      set({ conflict: null, saveState: 'idle' });
      await get().loadProject(projectId);
      return;
    }

    // keep-mine: re-apply the local patch on top of the current server
    // revision. This is a deliberate overwrite, chosen by the user.
    const server = conflict.serverProject ?? (await getProject(projectId));
    if (!server) {
      set({ error: 'This project was deleted elsewhere.', conflict: null, saveState: 'error' });
      return;
    }
    pendingPatch = { ...conflict.localPatch, ...pendingPatch };
    set({ project: { ...server, ...conflict.localPatch }, conflict: null, saveState: 'saving' });
    await get().flush();
  },
}));

/** Ensure a project has an output artifact; used when opening a fresh project. */
export async function ensureOutputArtifact(
  projectId: string,
  userId: string
): Promise<Artifact> {
  const artifacts = await listArtifacts(projectId);
  const existing = artifacts.find((a) => a.kind === 'output');
  if (existing) return existing;
  return createArtifact(projectId, userId, 'output', 'Output');
}
