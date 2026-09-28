import { describe, expect, it } from 'vitest';

import { assertHonestOutcome, changedSomething } from './outcome';
import type { StepOutcome } from './perform';

const ok = (changes: StepOutcome['changes']): StepOutcome => ({
  status: 'succeeded', label: 'designed', output: 'Done.', toolsUsed: ['model'], changes,
});

describe('"succeeded" means the project changed (SN-25)', () => {
  it('a mutating move that reports success with no change is recorded as failed, keeping its words', () => {
    for (const key of ['draft_stage', 'revise_stage', 'generate_outline', 'draft_sections', 'revise_sections', 'apply_findings']) {
      const out = assertHonestOutcome(key, ok({}));
      expect(out.status).toBe('failed');
      expect(out.output).toMatch(/^Done\.\n\nRecorded as failed/);
    }
  });

  it('a mutating move with a version or written sections stands', () => {
    expect(assertHonestOutcome('draft_stage', ok({ version_ids: ['v'] })).status).toBe('succeeded');
    expect(assertHonestOutcome('draft_sections', ok({ sections_written: ['s1'] })).status).toBe('succeeded');
  });

  it('reasoning, evaluation and workflow moves are not held to it', () => {
    expect(assertHonestOutcome('derive', ok({})).status).toBe('succeeded');
    expect(assertHonestOutcome('evaluate_stage', ok({})).status).toBe('succeeded');
    expect(assertHonestOutcome('request_user_decision', ok({})).status).toBe('succeeded');
  });

  it('a failed or blocked outcome is left alone', () => {
    const failed: StepOutcome = { ...ok({}), status: 'failed' };
    expect(assertHonestOutcome('draft_stage', failed)).toBe(failed);
  });

  it('changedSomething reads every kind of change', () => {
    expect(changedSomething(undefined)).toBe(false);
    expect(changedSomething({})).toBe(false);
    expect(changedSomething({ event_types: ['stage_advanced'] })).toBe(true);
    expect(changedSomething({ sandbox_run_id: 'r' })).toBe(true);
    expect(changedSomething({ jobs: ['j'] })).toBe(false);
  });
});
