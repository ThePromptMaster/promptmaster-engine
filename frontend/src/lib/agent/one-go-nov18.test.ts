import { describe, expect, it } from 'vitest';

import { claimDrive, isDuplicateRun, isRunEnded, isStepClash, releaseDrive, stillDriving } from '@/components/workflow/use-go-loop';
import { templateFitsProject } from '@/lib/workflow/template-fit';

// 18 Nov, Sean's Warehouse run 36e80b91 (and 6be5df58, 279badb4): a new project
// opened after another one was paired for one render with the old project's
// workflow; Go's auto-start drafted the old first stage, a second loop adopted
// the same run, the loser of the step-number race marked the run failed, and
// the survivor retried a refused approval three times.

describe('templateFitsProject', () => {
  it('fits only the pinned version', () => {
    expect(templateFitsProject({ id: 't-new', key: 'custom_a' }, { workflow_template_id: 't-new', workflow: 'custom_a' })).toBe(true);
    // The previous project's workflow, still on hand while the new project loads.
    expect(templateFitsProject({ id: 't-hidden-innovation', key: 'custom_7ba94411f8' }, { workflow_template_id: 't-new', workflow: 'custom_19f9158893' })).toBe(false);
  });
  it('an unpinned project fits the latest of its kind', () => {
    expect(templateFitsProject({ id: 'x', key: 'book' }, { workflow_template_id: null, workflow: 'book' })).toBe(true);
    expect(templateFitsProject({ id: 'x', key: 'research' }, { workflow_template_id: null, workflow: 'book' })).toBe(false);
  });
  it('nothing fits nothing', () => {
    expect(templateFitsProject(null, { workflow_template_id: 't' })).toBe(false);
    expect(templateFitsProject({ id: 't', key: 'k' }, null)).toBe(false);
  });
});

describe('a clash or an ended run', () => {
  const clash = { code: '23505', message: 'duplicate key value violates unique constraint "agent_steps_run_idx_key"' };
  const failed = { code: '23514', message: 'agent run 36e80b91-bc9f-45b2-8baf-d427282fb9fb is failed, not running' };
  const ended = { code: '23514', message: 'agent run 36e80b91-bc9f-45b2-8baf-d427282fb9fb has ended (failed); start a new run' };

  it('reads the step-number clash, and only that', () => {
    expect(isStepClash(clash)).toBe(true);
    expect(isStepClash({ code: '23505', message: 'duplicate key value violates unique constraint "agent_runs_one_running_per_project"' })).toBe(false);
    expect(isStepClash(new Error('network'))).toBe(false);
  });
  it('reads the database refusing a write to a run that is over', () => {
    expect(isRunEnded(failed)).toBe(true);
    expect(isRunEnded(ended)).toBe(true);
    expect(isRunEnded({ message: 'agent run abc is stopped, not running' })).toBe(true);
    expect(isRunEnded(clash)).toBe(false);
    expect(isRunEnded(new Error('The step failed.'))).toBe(false);
  });
  it('a second run for the project is still read as one (unchanged)', () => {
    expect(isDuplicateRun({ code: '23505', message: 'agent_runs_one_running_per_project' })).toBe(true);
  });
});

describe('one loop per run in a tab', () => {
  it("another page's loop cannot take a run this page drives", () => {
    const oldPage = {};
    const newPage = {};
    const held = claimDrive('run-1', oldPage);
    expect(held).not.toBeNull();
    expect(claimDrive('run-1', newPage)).toBeNull();
    releaseDrive('run-1', held!);
    // Once the old loop has let go, the page on screen takes it over.
    expect(claimDrive('run-1', newPage)).not.toBeNull();
  });
  it("the same page restarting its loop takes the run, and the old loop's release does not free the new one", () => {
    const page = {};
    const first = claimDrive('run-2', page)!;
    const second = claimDrive('run-2', page)!;
    expect(second).not.toBe(first);
    releaseDrive('run-2', first);
    expect(claimDrive('run-2', {})).toBeNull();
    releaseDrive('run-2', second);
    expect(claimDrive('run-2', {})).not.toBeNull();
  });
});

describe('a run ended elsewhere stops the loop before its next move', () => {
  // 18 Nov hand pass: run 2f555ad8 stopped from outside while Go drove it; five
  // more moves were made before the approval commit was refused.
  it('only a running run with no end is driven', () => {
    expect(stillDriving({ status: 'running', ended_at: null })).toBe(true);
    expect(stillDriving({ status: 'stopped', ended_at: '2026-11-18T11:08:02Z' })).toBe(false);
    expect(stillDriving({ status: 'failed', ended_at: null })).toBe(false);
    expect(stillDriving({ status: 'awaiting_decision', ended_at: null })).toBe(false);
    expect(stillDriving({ status: 'running', ended_at: '2026-11-18T11:08:02Z' })).toBe(false);
  });
});
