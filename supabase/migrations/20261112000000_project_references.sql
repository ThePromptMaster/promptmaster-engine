-- Client, 21 Oct (email 5): "the project you are working on can use that
-- information from those other chosen files or projects".
--
-- `project_references`: another of the user's projects that this one draws
-- on. The browser reads the referenced project's deliverable and facts under
-- RLS and sends them with each request (`PMInput.references`); the backend,
-- which owns no data, puts them in the prompt as read-only material, ranked
-- below this project's own. At most five per project.
--
-- Both sides carry the composite (id, user_id) key, so a project can only
-- reference its own owner's projects, even from a service-role client.
-- Purging either project removes the reference; a soft-deleted one is skipped
-- by the browser and cannot be newly referenced.
--
-- Idempotent: safe to re-run; applies to an empty database.

create table if not exists public.project_references (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null,
  user_id                uuid not null references auth.users(id) on delete cascade,
  referenced_project_id  uuid not null,
  include_facts          boolean not null default true,
  position               integer not null default 0,
  created_at             timestamptz not null default now(),
  constraint project_references_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint project_references_target_fk foreign key (referenced_project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint project_references_not_self check (project_id <> referenced_project_id),
  constraint project_references_once unique (project_id, referenced_project_id)
);

create index if not exists project_references_project_idx on public.project_references (project_id, position);

-- Five at most: every one rides in every prompt the project makes.
create or replace function public.project_references_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.project_references r where r.project_id = new.project_id) >= 5 then
    raise exception 'a project can draw on at most five other projects' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_references_cap on public.project_references;
create trigger project_references_cap before insert on public.project_references
  for each row execute function public.project_references_cap();

alter table public.project_references enable row level security;

drop policy if exists "project_references_select_own" on public.project_references;
create policy "project_references_select_own" on public.project_references
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "project_references_insert_own" on public.project_references;
create policy "project_references_insert_own" on public.project_references
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = referenced_project_id and p.user_id = auth.uid() and p.deleted_at is null
    )
  );

drop policy if exists "project_references_update_own" on public.project_references;
create policy "project_references_update_own" on public.project_references
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "project_references_delete_own" on public.project_references;
create policy "project_references_delete_own" on public.project_references
  for delete to authenticated using (user_id = auth.uid());
