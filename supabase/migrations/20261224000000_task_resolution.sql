-- A task keeps why it closed (L-315, 27 Nov).
--
-- Sean, payroll cutover: after South's completion report the final pack said
-- North N8 was the only run left, while "Carried forward" still told the next
-- operator to run South on the old system. Tasks an objective check records are
-- sentences of the deliverable; once the deliverable no longer says one, the
-- task is retired. He asked to keep the history and to see which report retired
-- it, so a closed task now says why, who closed it, and what it rested on.
--
-- Ordinary columns on ordinary user data (project_tasks has owner update and
-- delete policies already); nothing here is audit evidence. Idempotent.

alter table public.project_tasks add column if not exists resolution text;
alter table public.project_tasks add column if not exists resolved_by text;
-- Where the task came from and, once closed, what closed it: the version it was
-- drawn from, the version that no longer says it, the change before that
-- version, and a quoted fact when one reports it done.
alter table public.project_tasks add column if not exists basis jsonb;
-- The deliverable version the task was drawn from. Not a foreign key: a copy of
-- the project remaps it (copy_project_remap), and a deleted version leaves the
-- task's history readable.
alter table public.project_tasks add column if not exists origin_version_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_resolved_by_chk') then
    alter table public.project_tasks
      add constraint tasks_resolved_by_chk check (resolved_by is null or resolved_by in ('user', 'system'));
  end if;
end;
$$;
