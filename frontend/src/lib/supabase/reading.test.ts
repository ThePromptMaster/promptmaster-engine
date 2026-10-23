import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';

const project = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const heads = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('./projects', () => ({ getProject: vi.fn(async () => project.current) }));
vi.mock('./versions', () => ({
  listArtifacts: vi.fn(async () => [
    { id: 'a1', stage_id: 'output', current_version_id: 'v2' },
    { id: 'a2', stage_id: 'input', current_version_id: null },
  ]),
}));
vi.mock('./workflow', () => ({
  getTemplateById: vi.fn(async () => SINGLE_OUTPUT_V1),
  getLatestTemplate: vi.fn(async () => SINGLE_OUTPUT_V1),
  listWorkflowEvents: vi.fn(async () => []),
}));
const inArgs = vi.fn();
vi.mock('./client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        in: (...args: unknown[]) => {
          inArgs(...args);
          return Promise.resolve({ data: heads.rows, error: null });
        },
      }),
    }),
  }),
}));

import { loadProjectForReading } from './reading';

beforeEach(() => {
  inArgs.mockClear();
  heads.rows = [{ id: 'v2', content: 'The memo.' }];
  project.current = { id: 'p2', title: 'Other', workflow: 'single_output', workflow_template_id: 't', stage: 'output', deleted_at: null };
});

describe('loadProjectForReading (client feedback, 21 Oct, email 4)', () => {
  it('reads each stage with only its head version', async () => {
    const read = await loadProjectForReading('p2');
    expect(inArgs).toHaveBeenCalledWith('id', ['v2']);
    expect(read?.bundles.output.versions.map((v) => v.content)).toEqual(['The memo.']);
    expect(read?.bundles.input.versions).toEqual([]);
    expect(read?.state.current_stage_id).toBe('output');
  });

  it('reads nothing of a project in the trash or gone', async () => {
    project.current = { ...project.current, deleted_at: '2026-10-20T00:00:00Z' };
    expect(await loadProjectForReading('p2')).toBeNull();
    project.current = null;
    expect(await loadProjectForReading('p2')).toBeNull();
  });
});
