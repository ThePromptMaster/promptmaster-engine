/**
 * The large-job threshold exists in two languages, so something has to hold
 * them together.
 *
 * `LARGE_JOB_SECTIONS` in the client decides whether to *ask* the server for an
 * estimate at all; `LARGE_JOB_SECTION_THRESHOLD` in `promptmaster/limits.py`
 * decides whether the response says `is_large` and carries the warning text.
 * The duplication is deliberate — asking the server whether to ask the server
 * would put a round-trip in front of every small draft — but a silent
 * divergence is the worst of both: the client would open a dialog the server
 * then declined to write a warning for, leaving an empty confirmation with no
 * explanation in it.
 *
 * This is the same trick `seed-drift.test.ts` uses for the template migration:
 * read the other language's source and assert the number agrees.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LARGE_JOB_SECTIONS, isLargeJob } from './large-job-warning';

function backendThreshold(): number {
  const source = readFileSync(
    join(process.cwd(), '..', 'backend', 'promptmaster', 'limits.py'),
    'utf8'
  );
  const match = source.match(/^LARGE_JOB_SECTION_THRESHOLD\s*=\s*(\d+)/m);
  if (!match) {
    throw new Error(
      'LARGE_JOB_SECTION_THRESHOLD was not found in backend/promptmaster/limits.py. ' +
        'If it was renamed, this guard needs updating rather than deleting.'
    );
  }
  return Number(match[1]);
}

describe('large-job threshold', () => {
  it('matches the backend constant', () => {
    expect(LARGE_JOB_SECTIONS).toBe(backendThreshold());
  });

  it('warns at the threshold, not one past it', () => {
    expect(isLargeJob(LARGE_JOB_SECTIONS)).toBe(true);
    expect(isLargeJob(LARGE_JOB_SECTIONS - 1)).toBe(false);
  });

  it('does not interrupt a small run', () => {
    expect(isLargeJob(0)).toBe(false);
    expect(isLargeJob(3)).toBe(false);
  });
});
