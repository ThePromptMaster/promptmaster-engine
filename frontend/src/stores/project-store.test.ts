import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from './project-store';
import { ProjectConflictError, type Project } from '@/types/project';

const getProject = vi.hoisted(() => vi.fn());
const updateProject = vi.hoisted(() => vi.fn());
const listArtifacts = vi.hoisted(() => vi.fn());
const listVersions = vi.hoisted(() => vi.fn());
const getEvaluation = vi.hoisted(() => vi.fn());
const appendVersionRow = vi.hoisted(() => vi.fn());
const restoreVersionRow = vi.hoisted(() => vi.fn());
const rateVersionRow = vi.hoisted(() => vi.fn());
const saveEvaluation = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/projects', () => ({ getProject, updateProject }));
vi.mock('@/lib/supabase/versions', () => ({
  listArtifacts,
  listVersions,
  getEvaluation,
  appendVersion: appendVersionRow,
  restoreVersion: restoreVersionRow,
  rateVersion: rateVersionRow,
  saveEvaluation,
  createArtifact: vi.fn(),
}));

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', user_id: 'u1', title: 'T', objective: 'o', audience: 'General',
    constraints: '', output_format: '', mode: 'architect', custom_name: '',
    custom_preamble: '', custom_tone: '', model: '', session_facts: [],
    active_stack_id: null, constraint_presets: [], format_presets: [],
    workflow: 'single_output', stage: 'input', status: 'active', revision: 3,
    archived_at: null, deleted_at: null, legacy_session_id: null,
    created_at: '', updated_at: '', ...overrides,
  };
}

const ARTIFACT = {
  id: 'a1', user_id: 'u1', project_id: 'p1', kind: 'output' as const, name: 'Output',
  current_version_id: 'v1', version_count: 1, long_form: null, revision: 2,
  created_at: '', updated_at: '',
};

const V1 = {
  id: 'v1', user_id: 'u1', project_id: 'p1', artifact_id: 'a1', version_number: 1,
  parent_version_id: null, source_operation: 'initial', instruction: '', system_prompt: '',
  content: 'first', model: '', mode: 'architect' as const, change_summary: null,
  restored_from_version_id: null, finish_reason: null, user_rating: null,
  continuity_snapshot: null, created_at: '',
};

async function loadFixture() {
  getProject.mockResolvedValue(project());
  listArtifacts.mockResolvedValue([ARTIFACT]);
  listVersions.mockResolvedValue([V1]);
  getEvaluation.mockResolvedValue(null);
  await useProjectStore.getState().loadProject('p1');
}

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().closeProject();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadProject', () => {
  it('hydrates project, artifact and versions', async () => {
    await loadFixture();
    const s = useProjectStore.getState();
    expect(s.project?.id).toBe('p1');
    expect(s.artifact?.id).toBe('a1');
    expect(s.versions).toHaveLength(1);
    expect(s.activeVersionId).toBe('v1');
  });

  it('reports a missing project instead of hanging in loading', async () => {
    getProject.mockResolvedValue(null);
    await useProjectStore.getState().loadProject('nope');
    expect(useProjectStore.getState().loading).toBe(false);
    expect(useProjectStore.getState().error).toMatch(/not found/i);
  });
});

describe('patchProject', () => {
  it('applies the edit locally straight away', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'Renamed' });
    // Typing must not wait on the network.
    expect(useProjectStore.getState().project?.title).toBe('Renamed');
    expect(useProjectStore.getState().saveState).toBe('saving');
  });

  it('debounces rather than writing on every keystroke', async () => {
    await loadFixture();
    const store = useProjectStore.getState();
    store.patchProject({ title: 'A' });
    store.patchProject({ title: 'AB' });
    store.patchProject({ title: 'ABC' });
    expect(updateProject).not.toHaveBeenCalled();

    updateProject.mockResolvedValue(project({ title: 'ABC', revision: 4 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(updateProject).toHaveBeenCalledTimes(1);
  });

  it('sends accumulated field patches, not a whole snapshot', async () => {
    await loadFixture();
    const store = useProjectStore.getState();
    store.patchProject({ title: 'A' });
    store.patchProject({ audience: 'Engineers' });

    updateProject.mockResolvedValue(project({ revision: 4 }));
    await vi.advanceTimersByTimeAsync(900);

    // A whole-snapshot write would clobber fields edited in another tab.
    expect(updateProject).toHaveBeenCalledWith('p1', { title: 'A', audience: 'Engineers' }, 3);
  });

  it('guards the write with the revision it loaded', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'A' });
    updateProject.mockResolvedValue(project({ revision: 4 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(updateProject.mock.calls[0][2]).toBe(3);
  });

  it('adopts the server revision so the next write is not stale', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'A' });
    updateProject.mockResolvedValue(project({ revision: 4 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(useProjectStore.getState().project?.revision).toBe(4);
    expect(useProjectStore.getState().saveState).toBe('saved');
  });

  it('keeps the patch for retry when a save fails', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'A' });
    updateProject.mockRejectedValueOnce(new Error('network'));
    await vi.advanceTimersByTimeAsync(900);
    expect(useProjectStore.getState().saveState).toBe('error');

    // The edit must not be silently dropped.
    updateProject.mockResolvedValue(project({ revision: 4 }));
    await useProjectStore.getState().flush();
    expect(updateProject).toHaveBeenLastCalledWith('p1', { title: 'A' }, 3);
  });
});

describe('conflicts', () => {
  it('surfaces a conflict rather than resolving it silently', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'mine' });
    updateProject.mockRejectedValue(
      new ProjectConflictError('stale', project({ title: 'theirs', revision: 9 }))
    );
    await vi.advanceTimersByTimeAsync(900);

    const s = useProjectStore.getState();
    expect(s.saveState).toBe('conflict');
    expect(s.conflict?.localPatch).toEqual({ title: 'mine' });
    expect(s.conflict?.serverProject?.title).toBe('theirs');
  });

  it('reload discards the local edit and rehydrates', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'mine' });
    updateProject.mockRejectedValue(
      new ProjectConflictError('stale', project({ title: 'theirs', revision: 9 }))
    );
    await vi.advanceTimersByTimeAsync(900);

    getProject.mockResolvedValue(project({ title: 'theirs', revision: 9 }));
    await useProjectStore.getState().resolveConflict('reload');

    expect(useProjectStore.getState().project?.title).toBe('theirs');
    expect(useProjectStore.getState().conflict).toBeNull();
  });

  it('keep-mine re-applies the local edit against the newer revision', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'mine' });
    updateProject.mockRejectedValueOnce(
      new ProjectConflictError('stale', project({ title: 'theirs', revision: 9 }))
    );
    await vi.advanceTimersByTimeAsync(900);

    updateProject.mockResolvedValue(project({ title: 'mine', revision: 10 }));
    await useProjectStore.getState().resolveConflict('keep-mine');

    // Re-sent against revision 9, not the stale 3.
    expect(updateProject).toHaveBeenLastCalledWith('p1', { title: 'mine' }, 9);
    expect(useProjectStore.getState().project?.title).toBe('mine');
  });
});

describe('versions', () => {
  it('appends a version and moves the head', async () => {
    await loadFixture();
    const v2 = { ...V1, id: 'v2', version_number: 2, content: 'second' };
    appendVersionRow.mockResolvedValue(v2);

    await useProjectStore.getState().appendVersion({ content: 'second', source_operation: 'refine' });

    const s = useProjectStore.getState();
    expect(s.versions.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(s.artifact?.current_version_id).toBe('v2');
    expect(s.activeVersionId).toBe('v2');
  });

  it('does not touch local state when the write fails', async () => {
    await loadFixture();
    appendVersionRow.mockRejectedValue(new Error('rls denied'));

    await expect(
      useProjectStore.getState().appendVersion({ content: 'x', source_operation: 'refine' })
    ).rejects.toThrow();
    expect(useProjectStore.getState().versions).toHaveLength(1);
  });

  it('setActiveVersion only changes what is displayed', async () => {
    await loadFixture();
    const before = useProjectStore.getState().artifact?.current_version_id;
    useProjectStore.getState().setActiveVersion('v1');
    // Browsing history must never mutate the project.
    expect(useProjectStore.getState().artifact?.current_version_id).toBe(before);
    expect(appendVersionRow).not.toHaveBeenCalled();
  });

  it('restore appends a new head instead of rewinding', async () => {
    await loadFixture();
    const v3 = { ...V1, id: 'v3', version_number: 3, content: 'first', restored_from_version_id: 'v1' };
    restoreVersionRow.mockResolvedValue(v3);
    getEvaluation.mockResolvedValue(null);

    await useProjectStore.getState().restoreVersion('v1');

    const s = useProjectStore.getState();
    expect(s.versions).toHaveLength(2);
    expect(s.artifact?.current_version_id).toBe('v3');
    expect(s.versions.at(-1)?.restored_from_version_id).toBe('v1');
  });
});
