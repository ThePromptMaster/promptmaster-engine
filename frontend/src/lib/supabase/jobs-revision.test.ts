import { describe, expect, it } from 'vitest';

import { revisionToEnqueue } from './jobs';

describe('revisionToEnqueue (PM-04)', () => {
  it('keeps the section’s own revision when nothing has stopped', () => {
    expect(revisionToEnqueue({ revision: 2 }, null)).toBe(2);
    expect(revisionToEnqueue({ revision: 2 }, { status: 'queued', payload: { revision: 2 } })).toBe(2);
    expect(revisionToEnqueue({}, { status: 'succeeded', payload: { revision: 0 } })).toBe(0);
  });

  it('moves past a job that gave up, so resuming or retrying is not a silent no-op', () => {
    // Same revision = same idempotency key = enqueue_job does nothing.
    expect(revisionToEnqueue({ revision: 0 }, { status: 'dead', payload: { revision: 0 } })).toBe(1);
    expect(revisionToEnqueue({ revision: 0 }, { status: 'failed', payload: { revision: 0 } })).toBe(1);
  });

  it('keeps moving on a second retry', () => {
    // The section's revision only changes when it is written, so a retry that
    // also failed must be stepped past by the job's revision, not the section's.
    expect(revisionToEnqueue({ revision: 0 }, { status: 'failed', payload: { revision: 1 } })).toBe(2);
  });
});
