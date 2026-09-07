/**
 * The single-output workflow, walked end to end through the workspace.
 *
 * This is the test that had to exist before /session could be deleted. The old
 * flow was five hand-written phase components and a 450-line store; the claim
 * this replaces it with is that the same five steps fall out of a template and
 * two renderers. A test that asserted on fixtures shaped to agree would prove
 * nothing, so everything here is real: the shipped `SINGLE_OUTPUT_V1`, the real
 * `projectState` projection over an event log the test appends to, the real
 * exit-criteria evaluation, and the real renderers. Only Supabase and the
 * model are faked, and they are faked as stores rather than as canned answers —
 * a version appended in stage three is genuinely there in stage five.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCallback, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- the fakes, declared before the component that reaches for them ---------

const events: WorkflowEvent[] = [];

const listWorkflowEvents = vi.fn(async () => events.map((e) => ({ ...e })));
const appendWorkflowEvent = vi.fn(
  async (
    projectId: string,
    userId: string,
    event: Partial<WorkflowEvent> & { type: string; stage_id: string },
    seq: number
  ) => {
    events.push({
      id: `e${seq}`,
      project_id: projectId,
      user_id: userId,
      seq,
      created_at: `2026-09-07T00:00:${String(seq).padStart(2, '0')}Z`,
      to_stage_id: null,
      reason: null,
      ...event,
    } as WorkflowEvent);
  }
);

vi.mock('@/lib/supabase/workflow', () => ({
  listWorkflowEvents: (...args: unknown[]) =>
    (listWorkflowEvents as unknown as (...a: unknown[]) => unknown)(...args),
  appendWorkflowEvent: (...args: unknown[]) =>
    (appendWorkflowEvent as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('@/lib/supabase/versions', () => ({
  saveLongForm: vi.fn(async () => undefined),
}));

/** One model call per stage, answering with something recognisably that stage's. */
const generateStageArtifact = vi.fn(
  async (req: { stage: { id: string }; item_schema: unknown }) => ({
    content: `Generated for the ${req.stage.id} stage.`,
    items: req.item_schema
      ? [{ id: `${req.stage.id}-1`, statement: `A point raised at ${req.stage.id}.` }]
      : [],
    finish_reason: 'stop',
  })
);

vi.mock('@/lib/api/client', () => ({
  api: { generateStageArtifact: (...a: unknown[]) => generateStageArtifact(...(a as [never])) },
  ApiError: class ApiError extends Error {},
}));

import { WorkflowWorkspace } from './workflow-workspace';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { NewVersion } from '@/lib/supabase/versions';
import type { StageBundle } from '@/stores/project-store';

// --- a project, and a store for the artifacts it grows ----------------------

function newProject(): Project {
  return {
    id: 'p1',
    user_id: 'u1',
    title: 'A memo',
    objective: '',
    audience: '',
    constraints: '',
    output_format: '',
    mode: 'architect',
    custom_name: '',
    custom_preamble: '',
    custom_tone: '',
    model: 'test/model',
    session_facts: [],
    active_stack_id: null,
    constraint_presets: [],
    format_presets: [],
    workflow: 'single_output',
    workflow_template_id: 'tpl-1',
    stage: 'input',
    status: 'active',
    manual_checks: {},
    revision: 1,
    archived_at: null,
    deleted_at: null,
    legacy_session_id: null,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
  };
}

/**
 * The workspace's Supabase side, in memory.
 *
 * Held in React state rather than a module variable so that appending a
 * version re-renders the workspace exactly as the real store does — the
 * auto-draft effect keys off the bundle map, and a mutation it never sees
 * would make the test pass for the wrong reason.
 */
function Harness({ template = SINGLE_OUTPUT_V1 }: { template?: typeof SINGLE_OUTPUT_V1 }) {
  const [project, setProject] = useState<Project>(newProject);
  const [bundles, setBundles] = useState<Record<string, StageBundle>>({});
  const [nonce, setNonce] = useState(0);

  const onPatchProject = useCallback(
    (patch: Partial<Project>) => setProject((p) => ({ ...p, ...patch })),
    []
  );

  const ensureStageArtifact = useCallback(async (stageId: string, name: string) => {
    const artifact: Artifact = {
      id: `a-${stageId}`,
      user_id: 'u1',
      project_id: 'p1',
      kind: 'output',
      name,
      stage_id: stageId,
      summary: null,
      current_version_id: null,
      version_count: 0,
      long_form: null,
      created_at: '2026-09-07T00:00:00Z',
      updated_at: '2026-09-07T00:00:00Z',
    } as Artifact;
    setBundles((b) => (b[stageId] ? b : { ...b, [stageId]: { artifact, versions: [] } }));
    return artifact;
  }, []);

  const appendStageVersion = useCallback(
    async (stageId: string, name: string, version: NewVersion) => {
      const artifact = await ensureStageArtifact(stageId, name);
      let created: ArtifactVersion;
      setBundles((b) => {
        const held = b[stageId] ?? { artifact, versions: [] };
        created = {
          id: `${stageId}-v${held.versions.length + 1}`,
          user_id: 'u1',
          project_id: 'p1',
          artifact_id: artifact.id,
          version_number: held.versions.length + 1,
          parent_version_id: held.versions.at(-1)?.id ?? null,
          instruction: '',
          system_prompt: '',
          restored_from_version_id: null,
          user_rating: null,
          continuity_snapshot: null,
          created_at: '2026-09-07T00:00:00Z',
          ...version,
        } as ArtifactVersion;
        return {
          ...b,
          [stageId]: { artifact: held.artifact, versions: [...held.versions, created] },
        };
      });
      setNonce((n) => n + 1);
      return created!;
    },
    [ensureStageArtifact]
  );

  return (
    <WorkflowWorkspace
      key={nonce === -1 ? 'never' : 'stable'}
      project={project}
      artifact={null}
      versions={[]}
      stages={bundles}
      template={{ ...template, id: 'tpl-1' } as never}
      onPatchProject={onPatchProject}
      appendStageVersion={appendStageVersion}
      restoreStageVersion={async () => {}}
      setStageSummary={async () => {}}
      ensureStageArtifact={ensureStageArtifact}
      onReload={() => {}}
    />
  );
}

/** The transition bar, which is the only place a stage can be left from. */
function transitionBar() {
  return screen.getByText(/Ready to move on|items? outstanding/).parentElement!;
}

async function advance(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(within(transitionBar()).getByRole('button', { name: label }));
}

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
});

describe('the single-output workflow walks its five stages in the workspace', () => {
  it('carries a project from a blank objective to a finished output', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // --- 1. Input -----------------------------------------------------------
    // The objective editor is the one thing the legacy Input phase had that the
    // workspace did not; without it this blocking criterion could never be met.
    expect(await screen.findByRole('heading', { name: /Objective and setup/ })).toBeInTheDocument();
    expect(screen.getByText('Objective is stated')).toBeInTheDocument();
    expect(within(transitionBar()).getByText(/1 item outstanding/)).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Objective'),
      'Explain the migration to the board.'
    );

    await waitFor(() =>
      expect(within(transitionBar()).getByText(/Ready to move on/)).toBeInTheDocument()
    );

    // "No stage opens blank": entering Input drafted something to react to.
    await waitFor(() =>
      expect(screen.getByText(/Generated for the input stage/)).toBeInTheDocument()
    );

    await advance(user, /^Advance$/);

    // --- 2. Review ----------------------------------------------------------
    expect(await screen.findByRole('heading', { name: /Review the prompt/ })).toBeInTheDocument();
    // The objective panel belongs to the stage that asks for it, not to every stage.
    expect(screen.queryByLabelText('Objective')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Prompt looks right/ }));
    await advance(user, /^Advance$/);

    // --- 3. Output ----------------------------------------------------------
    expect(await screen.findByRole('heading', { name: /Output and evaluation/ })).toBeInTheDocument();

    // The stage's own auto-draft satisfies its blocking `artifact_non_empty`
    // criterion — nothing in the test writes the artifact by hand.
    await waitFor(() =>
      expect(screen.getByText(/Generated for the output stage/)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(within(transitionBar()).getByText(/Ready to move on/)).toBeInTheDocument()
    );

    await advance(user, /^Advance$/);

    // --- 4. Realign — offered every time, taken only when it is needed -------
    expect(await screen.findByRole('heading', { name: /Realignment/ })).toBeInTheDocument();
    await user.click(within(transitionBar()).getByRole('button', { name: /^Skip$/ }));
    await user.click(screen.getByRole('button', { name: 'Alignment and drift are already good' }));
    await user.click(screen.getByRole('button', { name: /^Skip stage$/ }));

    // --- 5. Summary ---------------------------------------------------------
    expect(await screen.findByRole('heading', { name: /Final review/ })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Output accepted/ }));
    await advance(user, /^Finish$/);

    // The event log is the record, and it is the log the walk actually wrote.
    expect(events.map((e) => [e.type, e.stage_id])).toEqual([
      ['stage_completed', 'input'],
      ['stage_completed', 'review'],
      ['stage_completed', 'output'],
      ['stage_skipped', 'realign'],
      ['stage_completed', 'summary'],
    ]);
    expect(events.find((e) => e.type === 'stage_skipped')!.reason).toBe(
      'Alignment and drift are already good'
    );

    // And the output survived the walk: browsing back to it shows the artifact.
    await user.click(screen.getByRole('button', { name: /Output/ }));
    expect(await screen.findByText(/Generated for the output stage/)).toBeInTheDocument();
  }, 30000);

  it('opens an imported project where its cursor says it got to', async () => {
    // Every project migrated from /session has a `projects.stage` and no
    // events. Starting them at stage one would file a finished output behind a
    // rail entry the user has no reason to click.
    render(<Harness />);
    expect(await screen.findByRole('heading', { name: /Objective and setup/ })).toBeInTheDocument();

    const { projectState, getStage } = await import('@/lib/workflow/engine');
    const resumed = projectState(SINGLE_OUTPUT_V1, [], 'summary');
    expect(resumed.current_stage_id).toBe('summary');
    // The cursor is all we know, so it is all we assert: nothing is back-filled
    // as complete.
    expect(resumed.stages.output?.status ?? 'not_started').toBe('not_started');
    expect(getStage(SINGLE_OUTPUT_V1, resumed.current_stage_id)!.renderer).toBe('review');
  });
});
