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
 * A new store rather than an extension of session-store.ts. That file is ~450
 * lines of flat session fields, and every field added there is one the legacy
 * flow has to carry too; the two can coexist while /session is still live.
 *
 * One store instance holding one project, not a map of projects. Around forty
 * components read the old store with no project context, so a store-per-project
 * design would force a React context and a hook threaded through all of them
 * for no user-visible gain — the UI shows one project at a time, and
 * multi-project concurrency comes free from browser tabs.
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

  /** Which version the UI is *displaying*. Never implies a restore. */
  activeVersionId: string | null;

  loading: boolean;
  error: string | null;

  /** A boolean cannot express "conflict", and FR-21 requires the user to see one. */
  saveState: SaveState;
  conflict: { serverProject: Project | null; localPatch: ProjectPatch } | null;

  loadProject: (id: string) => Promise<void>;
  closeProject: () => void;

  /** Optimistic local edit, flushed after a debounce. */
  patchProject: (patch: ProjectPatch) => void;
  /** Force the pending patch out now (tab hide, navigation, sign-out). */
  flush: () => Promise<void>;

  appendVersion: (version: NewVersion, evaluation?: NewEvaluation) => Promise<ArtifactVersion>;
  restoreVersion: (versionId: string) => Promise<void>;

  /** Create this stage's artifact if it has none yet. Idempotent. */
  ensureStageArtifact: (stageId: string, name: string) => Promise<Artifact>;
  /** Append a version to a specific stage's artifact, creating it if needed. */
  appendStageVersion: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<ArtifactVersion>;
  restoreStageVersion: (stageId: string, versionId: string) => Promise<void>;
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
  activeVersionId: null,
  loading: false,
  error: null,
  saveState: 'idle',
  conflict: null,

  async loadProject(id) {
    clearTimer();
    pendingPatch = {};
    set({ loading: true, error: null, projectId: id, saveState: 'idle', conflict: null });

    try {
      const project = await getProject(id);
      if (!project) {
        set({ loading: false, error: 'Project not found.', project: null });
        return;
      }

      const artifacts = await listArtifacts(id);

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
      // Only the head version's evaluation is needed to render; the rest load
      // lazily when the user opens version history.
      const head = versions[versions.length - 1];
      if (head) {
        const evaluation = await getEvaluation(head.id);
        if (evaluation) evaluations[head.id] = evaluation;
      }

      set({
        project,
        artifact,
        versions,
        stages,
        evaluations,
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
      activeVersionId: null,
      saveState: 'idle',
      conflict: null,
      error: null,
    });
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
    const { project } = get();
    const patch = pendingPatch;
    if (!project || Object.keys(patch).length === 0) return;

    pendingPatch = {};
    try {
      const updated = await updateProject(project.id, patch, project.revision);
      set({ project: updated, saveState: 'saved' });
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

  async appendStageVersion(stageId, name, version) {
    const artifact = await get().ensureStageArtifact(stageId, name);
    // Read the artifact back out of the store rather than reusing the one
    // above: version_count and revision move with every append, and a stale
    // copy would write version 2 twice.
    const current = get().stages[stageId]?.artifact ?? artifact;
    const created = await appendVersionRow(current, version);

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
      };
    });

    return created;
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
