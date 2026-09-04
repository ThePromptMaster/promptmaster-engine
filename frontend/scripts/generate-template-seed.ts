/**
 * Emit the workflow_templates seed migration from the TypeScript templates.
 *
 * The templates in src/lib/workflow/templates are the authoring source: they
 * are type-checked and covered by the integrity suite. Hand-writing the same
 * definitions as JSON in a migration would create a second source of truth
 * that silently drifts. Instead, revise the TypeScript and regenerate.
 *
 *   node scripts/generate-template-seed.ts > ../supabase/migrations/<ts>_seed_workflow_templates.sql
 */

import { BOOK_V1 } from '../src/lib/workflow/templates/book.v1.ts';
import { RESEARCH_V1 } from '../src/lib/workflow/templates/research.v1.ts';
import { SINGLE_OUTPUT_V1 } from '../src/lib/workflow/templates/single-output.v1.ts';

const TEMPLATES = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1];

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const rows = TEMPLATES.map((t) => {
  const definition = JSON.stringify({
    outline_stage: t.outline_stage,
    stages: t.stages,
  });
  return `  (${sqlString(t.key)}, ${t.version}, ${sqlString(t.name)}, ${sqlString(t.description)}, ${sqlString(definition)}::jsonb)`;
}).join(',\n');

process.stdout.write(`-- GENERATED FILE — do not edit by hand.
--
-- Produced by frontend/scripts/generate-template-seed.ts from the TypeScript
-- templates, which are the authoring source and are covered by the template
-- integrity tests. To change a workflow, edit the TypeScript and regenerate
-- into a NEW migration with a bumped version: published templates are
-- immutable, because projects pin the version they started on.

insert into public.workflow_templates (key, version, name, description, definition, status, is_system, published_at)
select v.key, v.version, v.name, v.description, v.definition, 'published', true, now()
from (values
${rows}
) as v(key, version, name, description, definition)
on conflict (key, version) do nothing;

-- Point migrated projects at the single_output template they were imported as.
-- They were created with workflow='single_output' by the sessions import.
update public.projects p
set workflow_template_id = t.id
from public.workflow_templates t
where t.key = 'single_output'
  and t.version = 1
  and p.workflow = 'single_output'
  and p.workflow_template_id is null;
`);
