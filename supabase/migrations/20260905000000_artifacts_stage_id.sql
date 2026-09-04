-- Artifacts belong to a stage.
--
-- A Book project produces thirteen artifacts, not one: an objective statement,
-- audience segments, a positioning statement, an outline, a manuscript, a claim
-- table, and so on. Until now `artifacts` had no stage column and the store
-- picked its artifact with `find(a => a.kind === 'output')`, which can only
-- ever describe a single-output project.
--
-- stage_id is deliberately free text with no FK: stage ids live inside a
-- workflow template's JSONB definition, so there is no table to reference, and
-- a project pins a template version whose stage set is fixed at that point.
-- The workflow engine validates; the database stores.
--
-- Nullable, because existing artifacts (the 65 imported single_output projects)
-- legitimately have no stage — they predate stages entirely.

alter table public.artifacts
  add column if not exists stage_id text;

-- One artifact per (project, stage, kind). A stage regenerating its draft
-- appends a VERSION to the existing artifact rather than creating a second one;
-- without this constraint a double-click on Regenerate would fork the stage's
-- history into two artifacts and the second would silently win.
create unique index if not exists artifacts_project_stage_kind_uidx
  on public.artifacts (project_id, stage_id, kind) where stage_id is not null;

create index if not exists artifacts_project_stage_idx
  on public.artifacts (project_id, stage_id) where stage_id is not null;

-- Backfill: the imported single_output projects have one 'output' artifact
-- that corresponds to the flow's output stage.
update public.artifacts a
set stage_id = 'output'
from public.projects p
where p.id = a.project_id
  and p.workflow = 'single_output'
  and a.kind = 'output'
  and a.stage_id is null;
