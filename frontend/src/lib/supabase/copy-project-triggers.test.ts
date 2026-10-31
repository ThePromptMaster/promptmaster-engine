import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Copying a project (31 Oct, 20261124000000_copy_project.sql) skips four
 * triggers that judge a row against the present, through a WHEN clause on
 * each. Migrations that add an event type recreate
 * workflow_events_agent_authorized as a matter of course; one that drops the
 * clause would make every copy fail. The latest definition of each must keep it.
 */
const DIR = join(__dirname, '../../../../supabase/migrations');
const TRIGGERS = ['workflow_events_agent_authorized', 'project_facts_on_insert', 'artifact_versions_assign_number', 'agent_steps_label_honest'];
const WHEN = "when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on')";

function latestDefinition(trigger: string): { file: string; statement: string } | null {
  let found: { file: string; statement: string } | null = null;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const re = new RegExp(`create trigger ${trigger}\\b[\\s\\S]*?;`, 'gi');
    for (const m of sql.matchAll(re)) found = { file, statement: m[0] };
  }
  return found;
}

describe('the triggers a project copy skips keep their WHEN clause', () => {
  for (const trigger of TRIGGERS) {
    it(trigger, () => {
      const latest = latestDefinition(trigger);
      expect(latest, `no migration creates ${trigger}`).not.toBeNull();
      expect(latest!.statement.toLowerCase().replace(/\s+/g, ' '), `${latest!.file} recreates ${trigger} without the copy clause`).toContain(WHEN);
    });
  }
});
