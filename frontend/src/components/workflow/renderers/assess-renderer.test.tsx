import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StageRenderer } from './stage-renderer';
import type { StageRendererProps } from './types';
import { DEFAULT_SCALE, appendBatch, parseAssessment, serializeAssessment } from '@/lib/workflow/assess';
import { itemSchemaFor } from '@/lib/workflow/stage-artifact';
import type { StageDefinition } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

const STAGE: StageDefinition = {
  id: 'assess', label: 'Assess', short_label: 'Assess', group: 'evaluation', required: true, renderer: 'assess',
  entry_guidance: '', entry_prompt_hint: 'Judge each against the criteria.', exit_criteria: [],
  expected_artifacts: [{ kind: 'assessments', cardinality: 'one' }], recommended_modes: [], skip_reasons: [],
  transitions: { default_next: null, allow_skip: false, allow_return_to: [] },
  assess: { scale: 'traffic', item_noun: 'profiles' },
};

function version(content: string, n = 1): ArtifactVersion {
  return {
    id: `v${n}`, user_id: 'u1', project_id: 'p1', artifact_id: 'a1', version_number: n, parent_version_id: null,
    source_operation: 'assess_batch', instruction: '', system_prompt: '', content, model: 'm', mode: 'architect',
    change_summary: null, restored_from_version_id: null, finish_reason: 'stop', user_rating: null,
    continuity_snapshot: null, created_at: '2026-10-25T00:00:00Z',
  };
}

function props(overrides: Partial<StageRendererProps> = {}): StageRendererProps {
  return {
    stage: STAGE, schema: itemSchemaFor(STAGE), versions: [], activeVersionId: null, onSelectVersion: vi.fn(),
    onRestore: vi.fn(async () => {}), onSaveContent: vi.fn(async () => {}), generating: false, generationError: null,
    onGenerate: vi.fn(), onCancelGeneration: vi.fn(), readOnly: false, ...overrides,
  };
}

const TABLE = serializeAssessment(DEFAULT_SCALE, appendBatch([], [
  { id: 'a', subject: 'Jane Doe — CFO', verdict: 'Green', rationale: '- Led 40', evidence: '"40 people"', gaps: '' },
  { id: 'b', subject: 'John Roe — Controller', verdict: 'Red', rationale: '- No team', evidence: '', gaps: 'No team size stated' },
], '2026-10-25T10:00:00Z'));

describe('the Assess stage (client, 25 Oct)', () => {
  it('asks for a scale and a paste, and sends both', async () => {
    const onAssessBatch = vi.fn(async () => ({ said: '2 assessed and added to the table.', keepText: false }));
    render(<StageRenderer {...props({ onAssessBatch })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '1–5' }));
    await user.type(screen.getByLabelText('Paste the profiles to assess'), 'Jane Doe — CFO');
    await user.click(screen.getByRole('button', { name: 'Assess' }));
    expect(onAssessBatch).toHaveBeenCalledWith(expect.objectContaining({ text: 'Jane Doe — CFO', existing: [] }));
    expect((onAssessBatch.mock.calls[0] as unknown as [{ scale: { id: string } }])[0].scale.id).toBe('score5');
    expect(await screen.findByText('2 assessed and added to the table.')).toBeInTheDocument();
  });

  it('shows each verdict as a chip, filters by level, and fixes the scale once there are rows', async () => {
    render(<StageRenderer {...props({ versions: [version(TABLE)], onAssessBatch: vi.fn(async () => ({ said: '', keepText: false })) })} />);
    expect(screen.queryByRole('radiogroup', { name: 'Scale' })).not.toBeInTheDocument();
    expect(screen.getByText('Judged on:')).toBeInTheDocument();
    const user = userEvent.setup();
    const filters = screen.getByRole('group', { name: 'Show' });
    await user.click(within(filters).getByRole('button', { name: /Red/ }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('John Roe — Controller')).toBeInTheDocument();
    expect(within(table).queryByText('Jane Doe — CFO')).not.toBeInTheDocument();
  });

  it('saves a removed row as a new version of the same table', async () => {
    const onSaveContent = vi.fn(async () => {});
    render(<StageRenderer {...props({ versions: [version(TABLE)], onSaveContent })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove John Roe — Controller' }));
    const saved = parseAssessment((onSaveContent.mock.calls[0] as unknown as [string])[0]);
    expect(saved?.items.map((i) => i.id)).toEqual(['a']);
    expect(saved?.scale?.id).toBe('traffic');
  });

  it('is read-only while browsing', () => {
    render(<StageRenderer {...props({ versions: [version(TABLE)], readOnly: true, onAssessBatch: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Assess' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('offers a sample batch from the stage\'s own spec: it fills the box and runs nothing', async () => {
    const onAssessBatch = vi.fn(async () => ({ said: 'done', keepText: false }));
    const stage = { ...STAGE, assess: { ...STAGE.assess!, offered_batch: 'Acme Fasteners. Revenue $62M.' } };
    render(<StageRenderer {...props({ stage, schema: itemSchemaFor(stage), onAssessBatch })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use the sample batch' }));
    expect(screen.getByLabelText('Paste the profiles to assess')).toHaveValue('Acme Fasteners. Revenue $62M.');
    expect(onAssessBatch).not.toHaveBeenCalled();
    // Filled, it has nothing more to offer.
    expect(screen.queryByRole('button', { name: 'Use the sample batch' })).toBeNull();
  });

  it('offers nothing when the stage has no sample', () => {
    render(<StageRenderer {...props({ onAssessBatch: vi.fn(async () => ({ said: 'done', keepText: false })) })} />);
    expect(screen.queryByRole('button', { name: 'Use the sample batch' })).toBeNull();
  });
});

describe('more batches, the rest of a paste, and finishing (15 Nov, Sean)', () => {
  const WITH_PENDING = serializeAssessment(DEFAULT_SCALE, parseAssessment(TABLE)!.items, { text: 'Candidate 13\nVP Ops', count: 13, batch: '1' });

  it('offers the items a paste left, and judges them from the table', async () => {
    const onAssessBatch = vi.fn(async () => ({ said: '13 assessed and added to the table.', keepText: false }));
    render(<StageRenderer {...props({ versions: [version(WITH_PENDING)], onAssessBatch })} />);
    expect(screen.getByText('13 more from your last paste are not judged yet.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Assess the remaining 13/ }));
    expect(onAssessBatch).toHaveBeenCalledWith(expect.objectContaining({ text: 'Candidate 13\nVP Ops', batch: '1' }));
  });

  it('on a finished stage, offers another batch; on the current one, finishing', async () => {
    const onReopenForBatch = vi.fn();
    const { unmount } = render(<StageRenderer {...props({ versions: [version(TABLE)], readOnly: true, onReopenForBatch })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Add another batch/ }));
    expect(onReopenForBatch).toHaveBeenCalled();
    unmount();
    const onFinishAssessing = vi.fn();
    render(<StageRenderer {...props({ versions: [version(TABLE)], onAssessBatch: vi.fn(async () => ({ said: '', keepText: false })), onFinishAssessing, nextStageLabel: 'Summary' })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Done — summarize on Summary/ }));
    expect(onFinishAssessing).toHaveBeenCalled();
  });
});

describe('a run that shows it is working, and stops (26 Nov, Sean: "it won\'t finish assessing")', () => {
  const WITH_PENDING = serializeAssessment(DEFAULT_SCALE, parseAssessment(TABLE)!.items, { text: 'Candidate 13\nVP Ops', count: 9, batch: '1' });
  const pageRun = { by: 'page' as const, judged: 12, left: 9, startedAt: Date.now() - 20_000 };

  it('says the rest is being judged now, not that it is "not judged yet"', () => {
    render(<StageRenderer {...props({ versions: [version(WITH_PENDING)], onAssessBatch: vi.fn(), assessRun: pageRun, onStopAssess: vi.fn() })} />);
    expect(screen.getByText('Judging the remaining 9 now.')).toBeInTheDocument();
    expect(screen.queryByText('9 more from your last paste are not judged yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assess the remaining/ })).toBeNull();
    expect(screen.getByRole('button', { name: /12 judged, judging the next 9/ })).toBeDisabled();
    expect(screen.getByText('About a minute for every twelve.')).toBeInTheDocument();
  });

  it('stops the page\'s run on Stop, and locks verdicts and removals while it runs', async () => {
    const onStopAssess = vi.fn();
    render(<StageRenderer {...props({ versions: [version(WITH_PENDING)], onAssessBatch: vi.fn(), assessRun: pageRun, onStopAssess })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Stop/ }));
    expect(onStopAssess).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove John Roe — Controller' })).toBeDisabled();
  });

  it('shows Go\'s run as Go\'s, with no Stop of its own', () => {
    render(<StageRenderer {...props({ versions: [version(WITH_PENDING)], onAssessBatch: vi.fn(), assessRun: { ...pageRun, by: 'go' }, onStopAssess: vi.fn() })} />);
    expect(screen.getByText('Go is judging the remaining 9 now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go is judging/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
  });

  it('keeps what a paste left when a verdict is changed by hand', async () => {
    const onSaveContent = vi.fn(async () => {});
    render(<StageRenderer {...props({ versions: [version(WITH_PENDING)], onSaveContent, onAssessBatch: vi.fn() })} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove John Roe — Controller' }));
    const saved = parseAssessment((onSaveContent.mock.calls[0] as unknown as [string])[0]);
    expect(saved?.pending).toEqual({ text: 'Candidate 13\nVP Ops', count: 9, batch: '1' });
  });

  it('leaves the paste in the box when a stop saved nothing', async () => {
    const onAssessBatch = vi.fn(async () => ({ said: 'Stopped before any were judged.', keepText: true }));
    render(<StageRenderer {...props({ onAssessBatch })} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Paste the profiles to assess'), 'Jane Doe — CFO');
    await user.click(screen.getByRole('button', { name: 'Assess' }));
    expect(await screen.findByText('Stopped before any were judged.')).toBeInTheDocument();
    expect(screen.getByLabelText('Paste the profiles to assess')).toHaveValue('Jane Doe — CFO');
  });
});

describe('which batches, then how they are sorted (26 Nov, Sean: "Latest batch + Best first")', () => {
  const page1 = appendBatch([], [
    { id: 'a', subject: 'Ann — COO', verdict: 'Green', rationale: '- ok', evidence: '', gaps: '' },
    { id: 'b', subject: 'Bo — VP', verdict: 'Red', rationale: '- no', evidence: '', gaps: '' },
  ], '2026-11-25T10:00:00Z', undefined, '1');
  const both = appendBatch(page1, [
    { id: 'c', subject: 'Cy — Plant GM', verdict: 'Red', rationale: '- no', evidence: '', gaps: '' },
    { id: 'd', subject: 'Di — COO', verdict: 'Amber', rationale: '- maybe', evidence: '', gaps: '' },
    { id: 'e', subject: 'Ed — COO', verdict: 'Green', rationale: '- yes', evidence: '', gaps: '' },
  ], '2026-11-26T09:00:00Z', undefined, '2');
  const TWO = serializeAssessment(DEFAULT_SCALE, both);
  const names = () => within(screen.getByRole('table')).getAllByText(/ — /).map((el) => el.textContent);

  it('shows only the latest batch, greens first, and remembers the choice for this stage', async () => {
    window.localStorage.clear();
    const { unmount } = render(<StageRenderer {...props({ versions: [version(TWO)], onAssessBatch: vi.fn(), assessRunKey: 'p1:assess' })} />);
    expect(names()).toEqual(['Ed — COO', 'Ann — COO', 'Di — COO', 'Cy — Plant GM', 'Bo — VP']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Which batches' }));
    await user.click(screen.getByRole('option', { name: /Latest batch: Batch 2 \(3\)/ }));
    expect(names()).toEqual(['Ed — COO', 'Di — COO', 'Cy — Plant GM']);
    unmount();
    render(<StageRenderer {...props({ versions: [version(TWO)], onAssessBatch: vi.fn(), assessRunKey: 'p1:assess' })} />);
    expect(names()).toEqual(['Ed — COO', 'Di — COO', 'Cy — Plant GM']);
    window.localStorage.clear();
  });

  it('pulls up an earlier batch, sorted newest first when asked', async () => {
    window.localStorage.clear();
    render(<StageRenderer {...props({ versions: [version(TWO)], onAssessBatch: vi.fn(), assessRunKey: 'p1:assess2' })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Which batches' }));
    await user.click(screen.getByRole('option', { name: /^Batch 1 .*\(2\)/ }));
    expect(names()).toEqual(['Ann — COO', 'Bo — VP']);
    await user.click(screen.getByRole('button', { name: /Best first/ }));
    expect(names()).toEqual(['Bo — VP', 'Ann — COO']);
    window.localStorage.clear();
  });
});
