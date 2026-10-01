import { describe, expect, it } from 'vitest';

import { assertHonestOutcome, changedSomething, verifyOutcome } from './outcome';
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

describe('"succeeded" is read back from the project (1 Oct, item 4)', () => {
  const found = [{ id: 'v', found: true, empty: false }];

  it('a saved version that is in the project stands', () => {
    for (const key of ['draft_stage', 'revise_stage', 'generate_outline', 'apply_findings', 'triage_findings']) {
      expect(verifyOutcome(key, ok({ version_ids: ['v'] }), { versions: found }).status).toBe('succeeded');
    }
  });

  it('a version that is not there, or holds nothing, fails the step and keeps its words', () => {
    const gone = verifyOutcome('draft_stage', ok({ version_ids: ['v'] }), { versions: [{ id: 'v', found: false, empty: true }] });
    expect(gone.status).toBe('failed');
    expect(gone.output).toMatch(/^Done\.\n\nRecorded as failed: the version this step says it saved was not found/);
    expect(verifyOutcome('generate_outline', ok({ version_ids: ['v'] }), { versions: [{ id: 'v', found: true, empty: true }] }).status).toBe('failed');
    expect(verifyOutcome('revise_stage', ok({ version_ids: ['v'] }), {}).status).toBe('failed');
  });

  it('written sections must hold text', () => {
    const out = ok({ sections_written: ['s1', 's2'] });
    expect(verifyOutcome('draft_sections', out, { sectionsWithContent: ['s1', 's2', 's3'] }).status).toBe('succeeded');
    const short = verifyOutcome('draft_sections', out, { sectionsWithContent: ['s1'] });
    expect(short.status).toBe('failed');
    expect(short.output).toContain('1 section this step says it wrote holds no text');
  });

  it('a check must have left an evaluation', () => {
    expect(verifyOutcome('evaluate_stage', ok({ version_ids: ['v'] }), { evaluated: true }).status).toBe('succeeded');
    expect(verifyOutcome('evaluate_stage', ok({ version_ids: ['v'] }), { evaluated: false }).status).toBe('failed');
  });

  it('a stage move must have moved the project, and a completion must be recorded as one', () => {
    const moved = ok({ event_types: ['stage_marked_complete'] });
    expect(verifyOutcome('advance_stage', moved, { stage: { currentStageId: 'b', status: 'complete', expectedStageId: 'b' } }).status).toBe('succeeded');
    expect(verifyOutcome('advance_stage', moved, { stage: { currentStageId: 'a', status: 'complete', expectedStageId: 'b' } }).status).toBe('failed');
    expect(verifyOutcome('advance_stage', moved, { stage: { currentStageId: 'b', status: 'in_progress', expectedStageId: 'b' } }).status).toBe('failed');
    const leftOpen = ok({ event_types: ['stage_advanced'] });
    expect(verifyOutcome('advance_stage', leftOpen, { stage: { currentStageId: 'b', status: 'in_progress', expectedStageId: 'b' } }).status).toBe('succeeded');
  });

  it('reasoning, questions and outcomes that already failed are not touched', () => {
    expect(verifyOutcome('derive', ok({}), {}).status).toBe('succeeded');
    expect(verifyOutcome('request_user_decision', ok({}), {}).status).toBe('succeeded');
    const failed: StepOutcome = { ...ok({}), status: 'failed' };
    expect(verifyOutcome('draft_stage', failed, {})).toBe(failed);
  });
});
