import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKFLOW_TEMPLATES } from './index';

/**
 * The seed migration is generated from these TypeScript templates. Nothing
 * stops someone editing the TypeScript and forgetting to regenerate, at which
 * point the database and the repo disagree about what a workflow is — and the
 * database is the one users actually run against.
 *
 * This test is the guard. If it fails: `npm run gen:templates` into a NEW
 * migration with a bumped version. Published templates are immutable, because
 * projects pin the version they started on.
 */
const MIGRATIONS = join(process.cwd(), '..', 'supabase', 'migrations');

function latestSeedSql(): string {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('_seed_workflow_templates.sql'))
    .sort()
    .at(-1);
  if (!file) throw new Error('no seed migration found');
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

/** Pull each `'{...}'::jsonb` literal back out of the generated SQL. */
function seededDefinitions(sql: string): Record<string, unknown>[] {
  return [...sql.matchAll(/'(\{"outline_stage".*?\})'::jsonb/gs)].map((m) =>
    JSON.parse(m[1].replace(/''/g, "'"))
  );
}

describe('generated seed matches the templates', () => {
  const definitions = seededDefinitions(latestSeedSql());

  it('seeds every template', () => {
    expect(definitions).toHaveLength(WORKFLOW_TEMPLATES.length);
  });

  it.each(WORKFLOW_TEMPLATES.map((t, i) => [t.key, i] as const))(
    '%s is byte-identical to its TypeScript definition',
    (key, index) => {
      const template = WORKFLOW_TEMPLATES[index];
      expect(definitions[index]).toEqual(
        JSON.parse(JSON.stringify({ outline_stage: template.outline_stage, stages: template.stages }))
      );
      expect(key).toBe(template.key);
    }
  );
});
