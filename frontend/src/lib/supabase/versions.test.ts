import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendVersion, createArtifact, restoreVersion } from './versions';
import type { Artifact, ArtifactVersion, Evaluation } from '@/types/project';

function makeSupabase() {
  const queued: Array<{ data: unknown; error: unknown }> = [];
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  let table = '';

  const builder: Record<string, unknown> = {};
  const chain = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ table, method: name, args });
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
    client: {
      from: vi.fn((t: string) => {
        table = t;
        return builder;
      }),
    },
    queue: (data: unknown, error: unknown = null) => queued.push({ data, error }),
    calls,
  };
}

const supa = vi.hoisted(() => ({ current: null as ReturnType<typeof makeSupabase> | null }));
vi.mock('./client', () => ({ createClient: () => supa.current!.client }));

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    user_id: 'u1',
    project_id: 'p1',
    kind: 'output',
    name: 'Output',
    stage_id: 'output',
    summary: null,
    current_version_id: 'v3',
    version_count: 3,
    long_form: null,
    outline_draft: null,
    revision: 7,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function version(overrides: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: 'v2',
    user_id: 'u1',
    project_id: 'p1',
    artifact_id: 'a1',
    version_number: 2,
    parent_version_id: 'v1',
    source_operation: 'refine',
    instruction: '',
    system_prompt: 'sys',
    content: 'the second draft',
    model: 'openai/gpt-5.4',
    mode: 'architect',
    change_summary: null,
    restored_from_version_id: null,
    finish_reason: null,
    user_rating: null,
    continuity_snapshot: null,
    created_at: '',
    ...overrides,
  };
}

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    user_id: 'u1',
    project_id: 'p1',
    version_id: 'v2',
    alignment_score: 'High',
    alignment_explanation: 'aligned',
    drift_score: 'Low',
    drift_explanation: 'focused',
    clarity_score: 'High',
    clarity_explanation: 'clear',
    completeness_status: 'complete',
    completeness_reason: null,
    interpretation: null,
    findings: [],
    needs_realignment: false,
    evaluator_model: 'openai/gpt-5.4',
    source: 'pipeline',
    created_at: '',
    ...overrides,
  };
}

const insertPayload = (table: string) =>
  supa.current!.calls.find((c) => c.table === table && c.method === 'insert')
    ?.args[0] as Record<string, unknown>;

beforeEach(() => {
  supa.current = makeSupabase();
});

describe('appendVersion', () => {
  it('lets the database number the version and pick its parent', async () => {
    // version_number and parent_version_id come from a trigger under a
    // per-artifact lock (20260927000200). A number computed from the cached
    // version_count is what stranded outlines behind an unmoved head.
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));

    const created = await appendVersion(artifact(), { content: 'next', source_operation: 'refine' });

    const payload = insertPayload('artifact_versions');
    expect(payload).not.toHaveProperty('version_number');
    expect(payload).not.toHaveProperty('parent_version_id');
    expect(created.version_number).toBe(4);
  });

  it('does not move the head itself, so no revision can make it fail', async () => {
    // The old revision-guarded head UPDATE failed whenever anything else had
    // touched the artifact — the outline draft autosave, a stage summary.
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));

    await appendVersion(artifact({ revision: 1 }), { content: 'next', source_operation: 'refine' });

    expect(
      supa.current!.calls.some((c) => c.table === 'artifacts' && c.method === 'update')
    ).toBe(false);
  });

  it('surfaces a failed insert', async () => {
    // A failed write must not leave the UI pointing at a version that does not exist.
    supa.current!.queue(null, { message: 'rls denied' });
    await expect(
      appendVersion(artifact(), { content: 'next', source_operation: 'refine' })
    ).rejects.toBeTruthy();
  });
});

describe('createArtifact', () => {
  it('returns the existing stage artifact when a concurrent create won', async () => {
    // Two openers of the outline stage raced into artifacts_project_stage_kind_uidx
    // and the loser showed "Could not open the outline."
    supa.current!.queue(null, { code: '23505', message: 'duplicate key value' });
    supa.current!.queue(artifact({ id: 'a-existing', kind: 'outline', stage_id: 'outline' }));

    const got = await createArtifact('p1', 'u1', 'outline', 'Outline', 'outline');

    expect(got.id).toBe('a-existing');
  });

  it('still surfaces other failures', async () => {
    supa.current!.queue(null, { message: 'rls denied' });
    await expect(createArtifact('p1', 'u1', 'outline', 'Outline', 'outline')).rejects.toBeTruthy();
  });
});

describe('restoreVersion', () => {
  it('appends a new version rather than mutating history', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null); // no prior evaluation

    const created = await restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }));

    const payload = insertPayload('artifact_versions');
    expect(created.version_number).toBe(4);
    expect(payload.source_operation).toBe('restore');
    expect(payload.restored_from_version_id).toBe('v2');
  });

  it('carries the old content forward verbatim', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null);

    await restoreVersion(
      artifact(),
      version({ id: 'v2', version_number: 2, content: 'the second draft' })
    );

    expect(insertPayload('artifact_versions').content).toBe('the second draft');
  });

  it('copies the evaluation forward instead of re-running it', async () => {
    // The content is byte-identical, so a second evaluator call would cost
    // money and could return a different score for the same text — which reads
    // to a user as a bug.
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(evaluation({ alignment_score: 'Medium' }));
    supa.current!.queue(evaluation());

    await restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }));

    const payload = insertPayload('evaluations');
    expect(payload.alignment_score).toBe('Medium');
    expect(payload.source).toBe('restored');
  });

  it('still restores when the target was never evaluated', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null); // no evaluation

    await expect(
      restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }))
    ).resolves.toMatchObject({ id: 'v4' });
  });
});
