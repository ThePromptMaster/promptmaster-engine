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
    const onAssessBatch = vi.fn(async () => '2 assessed and added to the table.');
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
    render(<StageRenderer {...props({ versions: [version(TABLE)], onAssessBatch: vi.fn(async () => '') })} />);
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
});
