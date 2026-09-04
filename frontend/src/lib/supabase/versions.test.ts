import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendVersion, restoreVersion } from './versions';
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
  it('numbers the new version after the current head', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null); // head-pointer update

    await appendVersion(artifact(), { content: 'next', source_operation: 'refine' });

    expect(insertPayload('artifact_versions').version_number).toBe(4);
  });

  it('links the new version to the one it supersedes', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null);

    await appendVersion(artifact(), { content: 'next', source_operation: 'refine' });

    expect(insertPayload('artifact_versions').parent_version_id).toBe('v3');
  });

  it('moves the artifact head to the new version', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null);

    await appendVersion(artifact(), { content: 'next', source_operation: 'refine' });

    const update = supa.current!.calls.find(
      (c) => c.table === 'artifacts' && c.method === 'update'
    );
    expect(update!.args[0]).toMatchObject({ current_version_id: 'v4', version_count: 4 });
  });

  it('surfaces a failed insert instead of moving the head', async () => {
    // A failed write must not leave the UI pointing at a version that does not exist.
    supa.current!.queue(null, { message: 'rls denied' });
    await expect(
      appendVersion(artifact(), { content: 'next', source_operation: 'refine' })
    ).rejects.toBeTruthy();
    expect(
      supa.current!.calls.some((c) => c.table === 'artifacts' && c.method === 'update')
    ).toBe(false);
  });
});

describe('restoreVersion', () => {
  it('appends a new version rather than mutating history', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null); // head update
    supa.current!.queue(null); // no prior evaluation

    await restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }));

    const payload = insertPayload('artifact_versions');
    expect(payload.version_number).toBe(4);
    expect(payload.source_operation).toBe('restore');
    expect(payload.restored_from_version_id).toBe('v2');
  });

  it('carries the old content forward verbatim', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null);
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
    supa.current!.queue(null);
    supa.current!.queue(evaluation({ alignment_score: 'Medium' }));
    supa.current!.queue(evaluation());

    await restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }));

    const payload = insertPayload('evaluations');
    expect(payload.alignment_score).toBe('Medium');
    expect(payload.source).toBe('restored');
  });

  it('still restores when the target was never evaluated', async () => {
    supa.current!.queue(version({ id: 'v4', version_number: 4 }));
    supa.current!.queue(null);
    supa.current!.queue(null); // no evaluation

    await expect(
      restoreVersion(artifact(), version({ id: 'v2', version_number: 2 }))
    ).resolves.toMatchObject({ id: 'v4' });
  });
});
