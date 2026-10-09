import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from './project-store';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
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
const listWorkflowEvents = vi.hoisted(() => vi.fn());
const appendWorkflowEvent = vi.hoisted(() => vi.fn());
const listRecommendations = vi.hoisted(() => vi.fn());
const supersedePending = vi.hoisted(() => vi.fn());
const listTasks = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/projects', () => ({ getProject, updateProject }));
vi.mock('@/lib/supabase/workflow', () => ({ listWorkflowEvents, appendWorkflowEvent }));
vi.mock('@/lib/supabase/recommendations', () => ({ listRecommendations, supersedePending }));
vi.mock('@/lib/supabase/tasks', () => ({ listTasks }));
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
    workflow: 'single_output', workflow_template_id: null, stage: 'input',
    status: 'active', manual_checks: {}, revision: 3,
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
  listWorkflowEvents.mockResolvedValue([]);
  listRecommendations.mockResolvedValue([]);
  listTasks.mockResolvedValue([]);
  await useProjectStore.getState().loadProject('p1');
}

const EVENT = (type: string, seq: number) => ({
  type, stage_id: 'input', actor: 'user' as const, created_at: `2026-09-28T00:00:0${seq}Z`,
});

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().closeProject();
  vi.clearAllMocks();
  listWorkflowEvents.mockResolvedValue([]);
  appendWorkflowEvent.mockResolvedValue(undefined);
  listRecommendations.mockResolvedValue([]);
  supersedePending.mockResolvedValue([]);
  listTasks.mockResolvedValue([]);
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

  it('a failed save retries by itself, a bounded number of times (4 Oct)', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'A' });
    updateProject.mockRejectedValueOnce(new Error('network'));
    await vi.advanceTimersByTimeAsync(900);
    expect(useProjectStore.getState().saveState).toBe('error');
    expect(updateProject).toHaveBeenCalledTimes(1);

    // No keystroke, no tab switch: it tries again on its own, with the edit.
    updateProject.mockResolvedValueOnce(project({ title: 'A', revision: 4 }));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(updateProject).toHaveBeenCalledTimes(2);
    expect(updateProject.mock.calls[1][1]).toEqual({ title: 'A' });
    expect(useProjectStore.getState().saveState).toBe('saved');
    expect(useProjectStore.getState().error).toBeNull();
  });

  it('stops retrying after three automatic attempts, and Retry now sends at once', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ title: 'A' });
    updateProject.mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(900 + 2_000 + 5_000 + 15_000 + 60_000);
    expect(updateProject).toHaveBeenCalledTimes(4);

    updateProject.mockResolvedValueOnce(project({ title: 'A', revision: 4 }));
    await useProjectStore.getState().retrySave();
    expect(updateProject).toHaveBeenCalledTimes(5);
    expect(useProjectStore.getState().saveState).toBe('saved');
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

describe('saves in flight (A1d)', () => {
  it('does not race two saves into a false "changed in another tab"', async () => {
    await loadFixture();
    // The first save is slow to answer; the server moves 3 -> 4.
    let answerFirst!: (p: Project) => void;
    updateProject.mockImplementationOnce(
      () => new Promise<Project>((resolve) => (answerFirst = resolve))
    );
    updateProject.mockImplementation(async (_id, patch, revision) => {
      // A stale revision is exactly what used to produce the false conflict.
      if (revision !== 4) throw new ProjectConflictError('stale', project({ revision: 99 }));
      return project({ ...patch, revision: 5 });
    });

    useProjectStore.getState().patchProject({ title: 'A' });
    const first = useProjectStore.getState().flush();
    useProjectStore.getState().patchProject({ objective: 'B' });
    const second = useProjectStore.getState().flush();

    answerFirst(project({ title: 'A', revision: 4 }));
    await first;
    await second;

    expect(useProjectStore.getState().conflict).toBeNull();
    expect(updateProject).toHaveBeenLastCalledWith('p1', { objective: 'B' }, 4);
  });

  it('keeps characters typed while a save was on the wire', async () => {
    await loadFixture();
    let answer!: (p: Project) => void;
    updateProject.mockImplementationOnce(() => new Promise<Project>((resolve) => (answer = resolve)));

    useProjectStore.getState().patchProject({ title: 'Gira' });
    const saving = useProjectStore.getState().flush();
    useProjectStore.getState().patchProject({ title: 'Giraffes' });
    answer(project({ title: 'Gira', revision: 4 }));
    await saving;

    // Replacing the project with the server row made the text jump back.
    expect(useProjectStore.getState().project?.title).toBe('Giraffes');
  });
});

describe('background reload (A1d)', () => {
  it('re-reads in place: no skeleton, and unsaved edits survive', async () => {
    await loadFixture();
    useProjectStore.getState().patchProject({ objective: 'typed but not saved yet' });

    const seen: boolean[] = [];
    const unsubscribe = useProjectStore.subscribe((st) => seen.push(st.loading));
    getProject.mockResolvedValue(project({ stage: 'review', revision: 4 }));
    await useProjectStore.getState().loadProject('p1', { background: true });
    unsubscribe();

    expect(seen).not.toContain(true);
    const s = useProjectStore.getState().project!;
    expect(s.stage).toBe('review');
    expect(s.objective).toBe('typed but not saved yet');

    // And the edit is still on its way to the server, against the new revision.
    updateProject.mockResolvedValue(project({ revision: 5 }));
    await useProjectStore.getState().flush();
    expect(updateProject).toHaveBeenCalledWith('p1', { objective: 'typed but not saved yet' }, 4);
  });

  it('a normal load still shows the skeleton and starts clean', async () => {
    await loadFixture();
    const seen: boolean[] = [];
    const unsubscribe = useProjectStore.subscribe((st) => seen.push(st.loading));
    await useProjectStore.getState().loadProject('p1');
    unsubscribe();
    expect(seen).toContain(true);
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

describe('the store owns the event log and the recommendations (A4, SN-01)', () => {
  it('loads events, recommendations and tasks with the project', async () => {
    getProject.mockResolvedValue(project());
    listArtifacts.mockResolvedValue([ARTIFACT]);
    listVersions.mockResolvedValue([V1]);
    getEvaluation.mockResolvedValue(null);
    listWorkflowEvents.mockResolvedValue([EVENT('stage_marked_complete', 1)]);
    listRecommendations.mockResolvedValue([{ id: 'r1', status: 'pending' }]);
    listTasks.mockResolvedValue([{ id: 't1', status: 'open' }]);

    expect(useProjectStore.getState().events).toBeNull();
    await useProjectStore.getState().loadProject('p1');

    const s = useProjectStore.getState();
    expect(s.events?.map((e) => e.type)).toEqual(['stage_marked_complete']);
    expect(s.recommendations.map((r) => r.id)).toEqual(['r1']);
    expect(s.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('a missing recommendations table does not take the project down', async () => {
    getProject.mockResolvedValue(project());
    listArtifacts.mockResolvedValue([ARTIFACT]);
    listVersions.mockResolvedValue([V1]);
    getEvaluation.mockResolvedValue(null);
    listWorkflowEvents.mockResolvedValue([]);
    listRecommendations.mockRejectedValue(new Error('relation does not exist'));
    listTasks.mockRejectedValue(new Error('relation does not exist'));

    await useProjectStore.getState().loadProject('p1');
    expect(useProjectStore.getState().project?.id).toBe('p1');
    expect(useProjectStore.getState().recommendations).toEqual([]);
    expect(useProjectStore.getState().events).toEqual([]);
  });

  it('a log that fails to load stays unread and says so, rather than reading as a reset project (4 Oct)', async () => {
    getProject.mockResolvedValue(project());
    listArtifacts.mockResolvedValue([ARTIFACT]);
    listVersions.mockResolvedValue([V1]);
    getEvaluation.mockResolvedValue(null);
    listWorkflowEvents.mockRejectedValueOnce(new Error('network'));

    await useProjectStore.getState().loadProject('p1');
    let s = useProjectStore.getState();
    expect(s.project?.id).toBe('p1');
    expect(s.events).toBeNull();
    expect(s.eventsError).toMatch(/history could not be loaded/);

    // Retry reads it and clears the error.
    listWorkflowEvents.mockResolvedValueOnce([EVENT('stage_marked_complete', 1)]);
    await useProjectStore.getState().refreshEvents();
    s = useProjectStore.getState();
    expect(s.events?.map((e) => e.type)).toEqual(['stage_marked_complete']);
    expect(s.eventsError).toBeNull();
  });

  it('a background reload that cannot read the log keeps the one on hand', async () => {
    await loadFixture();
    listWorkflowEvents.mockResolvedValue([EVENT('stage_marked_complete', 1)]);
    await useProjectStore.getState().refreshEvents();
    listWorkflowEvents.mockRejectedValueOnce(new Error('network'));

    await useProjectStore.getState().loadProject('p1', { background: true });
    const s = useProjectStore.getState();
    expect(s.events?.map((e) => e.type)).toEqual(['stage_marked_complete']);
    expect(s.eventsError).toBeNull();
  });

  it('appendEvent writes, then re-reads the log rather than trusting its own copy', async () => {
    await loadFixture();
    // What the database holds after the insert — including a row the server
    // wrote in the meantime, which a local push would have missed.
    listWorkflowEvents.mockResolvedValue([EVENT('section_written', 1), EVENT('stage_advanced', 2)]);

    const fresh = await useProjectStore.getState().appendEvent({ type: 'stage_advanced', stage_id: 'input' });

    expect(appendWorkflowEvent).toHaveBeenCalledWith('p1', 'u1', { type: 'stage_advanced', stage_id: 'input' });
    expect(fresh.map((e) => e.type)).toEqual(['section_written', 'stage_advanced']);
    expect(useProjectStore.getState().events).toEqual(fresh);
  });

  it('a write that landed but could not be re-read says so, rather than "nothing changed" (4 Oct)', async () => {
    await loadFixture();
    listWorkflowEvents.mockRejectedValueOnce(new Error('network'));
    const { EventRecordedError } = await import('./project-store');
    await expect(
      useProjectStore.getState().appendEvent({ type: 'stage_advanced', stage_id: 'input' })
    ).rejects.toBeInstanceOf(EventRecordedError);
    expect(appendWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('a failed write leaves the log as it was', async () => {
    await loadFixture();
    appendWorkflowEvent.mockRejectedValueOnce(new Error('duplicate key'));
    await expect(
      useProjectStore.getState().appendEvent({ type: 'stage_advanced', stage_id: 'input' })
    ).rejects.toThrow('duplicate key');
    expect(useProjectStore.getState().events).toEqual([]);
  });

  it('a refresh that lands after the project was closed is dropped', async () => {
    await loadFixture();
    let release: (v: unknown) => void = () => {};
    listWorkflowEvents.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const pending = useProjectStore.getState().refreshEvents();
    useProjectStore.getState().closeProject();
    release([EVENT('stage_advanced', 1)]);
    await pending;
    expect(useProjectStore.getState().events).toBeNull();
  });

  it('upsert replaces a row by id and appends an unknown one', () => {
    const s = useProjectStore.getState();
    s.upsertRecommendation({ id: 'r1', status: 'pending' } as never);
    s.upsertRecommendation({ id: 'r1', status: 'accepted' } as never);
    s.upsertRecommendation({ id: 'r2', status: 'pending' } as never);
    expect(useProjectStore.getState().recommendations.map((r) => `${r.id}:${r.status}`)).toEqual(['r1:accepted', 'r2:pending']);
    s.upsertTask({ id: 't1', status: 'open' } as never);
    s.upsertTask({ id: 't1', status: 'done' } as never);
    expect(useProjectStore.getState().tasks).toEqual([{ id: 't1', status: 'done' }]);
  });
});

describe('the commit check (4 Oct, Options)', () => {
  it('a revision that turns a table into prose is refused and the head stays', async () => {
    await loadFixture();
    const table = '{"kind":"stage_items","items":[{"id":"a","claim":"Option A"}]}';
    useProjectStore.setState({
      stages: { output: { artifact: { ...ARTIFACT, stage_id: 'output' } as never, versions: [{ ...V1, content: table } as never] } },
    });

    await expect(
      useProjectStore.getState().appendStageVersion('output', 'Output', { content: 'No claims yet.', source_operation: 'applied_recommendations' })
    ).rejects.toThrow(/current version was kept/);

    expect(appendVersionRow).not.toHaveBeenCalled();
    const bundle = useProjectStore.getState().stages.output;
    expect(bundle.artifact?.current_version_id).toBe('v1');
    expect(bundle.versions).toHaveLength(1);
  });
});

describe('leaving a stage retires the proposals raised on it (A5, SN-01)', () => {
  it('a stage-leaving event supersedes that stage\'s pending rows, and the store reflects it', async () => {
    await loadFixture();
    useProjectStore.setState({
      recommendations: [
        { id: 'r-move', status: 'pending', scope: { stage_id: 'input' } },
        { id: 'r-next', status: 'pending', scope: { stage_id: 'review' } },
        { id: 'r-done', status: 'accepted', scope: { stage_id: 'input' } },
      ] as never,
    });
    supersedePending.mockResolvedValue(['r-move']);

    await useProjectStore.getState().appendEvent({ type: 'stage_advanced', stage_id: 'input', to_stage_id: 'review' });

    expect(supersedePending).toHaveBeenCalledWith('p1', { stageId: 'input' });
    const byId = Object.fromEntries(useProjectStore.getState().recommendations.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ 'r-move': 'superseded', 'r-next': 'pending', 'r-done': 'accepted' });
  });

  it('finishing retires every pending "move on" proposal; blocking retires nothing', async () => {
    await loadFixture();
    await useProjectStore.getState().appendEvent({ type: 'project_finalized', stage_id: 'summary' });
    expect(supersedePending).toHaveBeenCalledWith('p1', { kind: 'stage_transition' });
    supersedePending.mockClear();
    await useProjectStore.getState().appendEvent({ type: 'stage_blocked', stage_id: 'input' });
    expect(supersedePending).not.toHaveBeenCalled();
  });

  it('a retire failure never fails the event', async () => {
    await loadFixture();
    supersedePending.mockRejectedValueOnce(new Error('offline'));
    listWorkflowEvents.mockResolvedValue([EVENT('stage_advanced', 1)]);
    const fresh = await useProjectStore.getState().appendEvent({ type: 'stage_advanced', stage_id: 'input' });
    expect(fresh.map((e) => e.type)).toEqual(['stage_advanced']);
  });

  it('a new head retires the old head\'s pending fixes, keeping the ones being applied', async () => {
    await loadFixture();
    appendVersionRow.mockResolvedValue({ ...V1, id: 'v2', version_number: 2 });
    useProjectStore.setState({ stages: { output: { artifact: { ...ARTIFACT, stage_id: 'output' } as never, versions: [V1 as never] } } });
    useProjectStore.setState({
      recommendations: [
        { id: 'r-old', status: 'pending', scope: { stage_id: 'output' }, version_id: 'v1' },
        { id: 'r-apply', status: 'pending', scope: { stage_id: 'output' }, version_id: 'v1' },
      ] as never,
    });
    supersedePending.mockResolvedValue(['r-old']);

    await useProjectStore.getState().appendStageVersion('output', 'Output', { content: 'second', source_operation: 'stage_edit' }, undefined, {
      keepRecommendations: ['r-apply'],
    });
    await Promise.resolve();

    expect(supersedePending).toHaveBeenCalledWith('p1', { stageId: 'output', except: ['r-apply'] });
    const byId = Object.fromEntries(useProjectStore.getState().recommendations.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ 'r-old': 'superseded', 'r-apply': 'pending' });
  });
});

describe('restoreStageVersion (H1c, 9 Oct)', () => {
  const done = [
    { type: 'stage_marked_complete', stage_id: 'objective', to_stage_id: 'audience', actor: 'user', created_at: '2026-10-06T10:00:00Z', payload: { evidence_version_id: 'v1' } },
    { type: 'stage_marked_complete', stage_id: 'audience', to_stage_id: 'positioning', actor: 'user', created_at: '2026-10-06T10:01:00Z', payload: { evidence_version_id: 'x' } },
  ];
  const V2 = { ...V1, id: 'v2', version_number: 2, content: 'second' };

  async function restoring(target: string) {
    await loadFixture();
    useProjectStore.setState({
      template: BOOK_V1 as never,
      events: done as never,
      stages: { objective: { artifact: { ...ARTIFACT, stage_id: 'objective', current_version_id: 'v2', version_count: 2 } as never, versions: [V1 as never, V2 as never] } },
    });
    restoreVersionRow.mockResolvedValue({ ...V1, id: 'v3', version_number: 3, restored_from_version_id: target });
    listWorkflowEvents.mockResolvedValue(done);
    await useProjectStore.getState().restoreStageVersion('objective', target);
  }

  it('reopens the done work after the stage, as a save does', async () => {
    await restoring('v1');
    expect(appendWorkflowEvent).toHaveBeenCalledWith('p1', 'u1', expect.objectContaining({
      type: 'stage_version_saved', stage_id: 'objective',
      payload: expect.objectContaining({ version_id: 'v3', prior_version_id: 'v2', affected: ['audience'], restored_from_version_id: 'v1' }),
    }));
  });

  it('restoring the version already current reopens nothing', async () => {
    await restoring('v2');
    expect(appendWorkflowEvent).not.toHaveBeenCalled();
  });
});
