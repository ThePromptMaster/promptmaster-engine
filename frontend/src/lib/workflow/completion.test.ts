import { describe, expect, it } from 'vitest';

import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { projectState, remainingStages } from './engine';
import { describeBasis } from './objective';
import type { WorkflowEvent } from './types';

const ev = (type: WorkflowEvent['type'], stage_id: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent =>
  ({ type, stage_id, actor: 'user', created_at: '2026-10-10T00:00:00Z', payload: {}, ...extra }) as WorkflowEvent;

describe('met is not finished (Sean, 10 Oct, email 2: "Finished" beside "2 done · 3 to go")', () => {
  it('names what the workflow still holds: required apart from optional', () => {
    const state = projectState(SINGLE_OUTPUT_V1, [
      ev('stage_marked_complete', 'input', { to_stage_id: 'review' }),
      ev('stage_marked_complete', 'review', { to_stage_id: 'output' }),
    ]);
    expect(remainingStages(SINGLE_OUTPUT_V1, state)).toEqual({ required: ['Output', 'Summary'], optional: ['Realign'] });
  });

  it('a skipped stage is not left to do', () => {
    const state = projectState(SINGLE_OUTPUT_V1, [
      ev('stage_marked_complete', 'input', { to_stage_id: 'review' }),
      ev('stage_marked_complete', 'review', { to_stage_id: 'output' }),
      ev('stage_marked_complete', 'output', { to_stage_id: 'realign' }),
      ev('stage_skipped', 'realign', { to_stage_id: 'summary', reason: 'The output is close enough' }),
    ]);
    expect(remainingStages(SINGLE_OUTPUT_V1, state)).toEqual({ required: ['Summary'], optional: [] });
  });
});

describe('what a check of the objective rested on (Sean, 10 Oct, emails 3, 5, 8)', () => {
  it('names the version, how each requirement was checked, and what was not verified', () => {
    expect(
      describeBasis({
        stage_id: 'output', stage_label: 'Output', version_id: 'v', version_number: 3,
        measured: ['Invitation: under 70 words — 64 words'],
        assessed: [{ requirement: 'Warm tone', verdict: 'met', basis: 'Join me for lunch.' }],
        not_checked: ['Fits on one page'],
      })
    ).toBe('Checked Output v3: 1 measured in code (Invitation: under 70 words — 64 words), 1 assessed by the AI model against the text. Not verified: Fits on one page.');
  });
});
