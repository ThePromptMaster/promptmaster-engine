import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject, updateProject } from './projects';
import { ProjectConflictError, type Project } from '@/types/project';

/**
 * Minimal stand-in for the supabase-js query builder. Every method returns
 * `this` so a chain can be built, and the terminal call resolves whatever the
 * test queued. `calls` records what was actually sent, which is how we assert
 * that revision never appears in an update payload.
 */
function makeSupabase() {
  const queued: Array<{ data: unknown; error: unknown }> = [];
  const calls: Array<Record<string, unknown>> = [];

  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method: name, args });
      return builder;
    });

  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'delete']) {
    builder[m] = chain(m);
  }
  const settle = () => Promise.resolve(queued.shift() ?? { data: null, error: null });
  builder.single = vi.fn(settle);
  builder.maybeSingle = vi.fn(settle);
  builder.then = (resolve: (v: unknown) => unknown) => settle().then(resolve);

  return {
    client: { from: vi.fn(() => builder) },
    queue: (data: unknown, error: unknown = null) => queued.push({ data, error }),
    calls,
  };
}

const supa = vi.hoisted(() => ({ current: null as ReturnType<typeof makeSupabase> | null }));
vi.mock('./client', () => ({ createClient: () => supa.current!.client }));

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    user_id: 'u1',
    title: 'A project',
    objective: 'o',
    audience: 'General',
    constraints: '',
    output_format: '',
    mode: 'architect',
    custom_name: '',
    custom_preamble: '',
    custom_tone: '',
    model: '',
    session_facts: [],
    active_stack_id: null,
    constraint_presets: [],
    format_presets: [],
    workflow: 'single_output',
    stage: 'input',
    status: 'active',
    revision: 4,
    archived_at: null,
    deleted_at: null,
    legacy_session_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  supa.current = makeSupabase();
});

describe('updateProject', () => {
  it('returns the updated row when the revision still matches', async () => {
    supa.current!.queue(project({ revision: 5, title: 'Renamed' }));
    const result = await updateProject('p1', { title: 'Renamed' }, 4);
    expect(result.title).toBe('Renamed');
    expect(result.revision).toBe(5);
  });

  it('guards the update on the known revision', async () => {
    supa.current!.queue(project({ revision: 5 }));
    await updateProject('p1', { title: 'x' }, 4);
    const eqs = supa.current!.calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['revision', 4]);
  });

  it('never sends revision in the payload', async () => {
    // revision is owned by a database trigger. A client that could set it
    // would echo its stale value back and defeat the guard entirely.
    supa.current!.queue(project({ revision: 5 }));
    await updateProject('p1', { title: 'x' }, 4);
    const update = supa.current!.calls.find((c) => c.method === 'update');
    expect(Object.keys((update!.args as [Record<string, unknown>])[0])).not.toContain('revision');
  });

  it('reports a stale conflict when the row still exists', async () => {
    supa.current!.queue(null); // the guarded update matched nothing
    supa.current!.queue(project({ revision: 9, title: 'Someone else' })); // the re-read

    await expect(updateProject('p1', { title: 'mine' }, 4)).rejects.toMatchObject({
      name: 'ProjectConflictError',
      reason: 'stale',
    });
  });

  it('carries the current server state on a stale conflict', async () => {
    supa.current!.queue(null);
    supa.current!.queue(project({ revision: 9, title: 'Someone else' }));

    // The UI needs this to offer "Reload" against something concrete.
    const err = await updateProject('p1', { title: 'mine' }, 4).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectConflictError);
    expect(err.current?.title).toBe('Someone else');
  });

  it('distinguishes a deleted project from a stale one', async () => {
    // Under RLS a zero-row update is ambiguous. Reporting "someone else edited
    // this" for a deleted project trains users to click Overwrite.
    supa.current!.queue(null); // update matched nothing
    supa.current!.queue(null); // re-read found nothing either

    const err = await updateProject('p1', { title: 'mine' }, 4).catch((e) => e);
    expect(err.reason).toBe('deleted');
    expect(err.current).toBeNull();
    expect(err.message).toMatch(/deleted/i);
  });

  it('propagates a real database error rather than calling it a conflict', async () => {
    supa.current!.queue(null, { message: 'connection reset' });
    await expect(updateProject('p1', { title: 'x' }, 4)).rejects.not.toBeInstanceOf(
      ProjectConflictError
    );
  });
});

describe('createProject', () => {
  it('defaults an untitled project rather than storing an empty string', async () => {
    supa.current!.queue(project({ title: 'Untitled project' }));
    await createProject({ title: '   ' }, 'u1');
    const insert = supa.current!.calls.find((c) => c.method === 'insert');
    expect((insert!.args as [Record<string, unknown>])[0].title).toBe('Untitled project');
  });

  it('starts new projects on the single_output workflow by default', async () => {
    supa.current!.queue(project());
    await createProject({ objective: 'Write a thing' }, 'u1');
    const insert = supa.current!.calls.find((c) => c.method === 'insert');
    expect((insert!.args as [Record<string, unknown>])[0].workflow).toBe('single_output');
  });
});
