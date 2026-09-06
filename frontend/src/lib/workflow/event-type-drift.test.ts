import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WorkflowEventType } from './types';

/**
 * The TypeScript event union and the workflow_events CHECK constraint have to
 * agree. They already drifted once: 'project_created' was valid in the database
 * and missing from the union. A compile error caught that one, but the reverse
 * — a union value the database rejects — fails at insert time, in front of a
 * user, with a constraint violation.
 */
const MIGRATIONS = join(process.cwd(), '..', 'supabase', 'migrations');

// Kept in step by hand with the union; the test is what makes that safe.
const UNION: WorkflowEventType[] = [
  'project_created',
  'stage_entered',
  'stage_completed',
  'stage_skipped',
  'stage_returned',
  'outline_approved',
  'outline_version_created',
  'section_written',
  'section_regenerated',
  'job_enqueued',
  'job_failed',
  'generation_paused',
  'generation_resumed',
  'imported_from_session',
];

function checkConstraintValues(): string[] {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('_workflow_templates.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

  const match = sql.match(/constraint we_type_chk check \(type in \(([\s\S]*?)\)\)/);
  if (!match) throw new Error('we_type_chk not found in migrations');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('workflow event types', () => {
  const allowed = checkConstraintValues();

  it('the database allows every value the union can produce', () => {
    // This is the direction that fails in front of a user.
    expect([...UNION].sort()).toEqual(expect.arrayContaining([...allowed].sort()));
    for (const value of UNION) expect(allowed).toContain(value);
  });

  it('the union covers every value the database allows', () => {
    for (const value of allowed) expect(UNION).toContain(value);
  });
});
