-- Client, 21 Oct (email 5): "organizing projects and folders ... a sidebar
-- somewhere that can arrow out and display all of the folders and projects
-- however someone wants to freely organize".
--
-- `project_folders`: a user's own folders, nested up to three deep. A project
-- is in at most one folder (`projects.folder_id`); none means Unfiled.
-- Deleting a folder files its projects as Unfiled and moves the folders inside
-- it to the top level (both `on delete set null` on the one column), never deleting work.
--
-- Moving a project between folders is not an edit of the project: it must not
-- bump `revision`, or an open tab of that project would report "changed
-- elsewhere" for a move made from the list. `projects_touch` now leaves a
-- folder-only update alone.
--
-- Idempotent: safe to re-run; applies to an empty database.

create table if not exists public.project_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  parent_id   uuid,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_folders_id_user_key unique (id, user_id),
  constraint project_folders_not_self check (parent_id is null or parent_id <> id)
);

-- A folder's parent belongs to the same user, even from a service-role client.
alter table public.project_folders drop constraint if exists project_folders_parent_fk;
alter table public.project_folders add constraint project_folders_parent_fk
  foreign key (parent_id, user_id) references public.project_folders (id, user_id)
  on delete set null (parent_id);

create index if not exists project_folders_user_idx on public.project_folders (user_id, parent_id, position);

-- No cycles, and at most three levels: a folder tree, not a maze.
create or replace function public.project_folders_tree_guard()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.parent_id;
  depth integer := 1;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'a folder cannot be inside itself' using errcode = 'check_violation';
    end if;
    depth := depth + 1;
    if depth > 3 then
      raise exception 'folders go at most three levels deep' using errcode = 'check_violation';
    end if;
    select f.parent_id into cursor_id from public.project_folders f where f.id = cursor_id;
  end loop;
  -- A moved folder takes its subfolders with it: they must still fit.
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    if exists (
      with recursive below as (
        select f.id, 1 as lvl from public.project_folders f where f.parent_id = new.id
        union all
        select f.id, b.lvl + 1 from public.project_folders f join below b on f.parent_id = b.id where b.lvl < 4
      )
      select 1 from below where depth + lvl > 3
    ) then
      raise exception 'folders go at most three levels deep' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_folders_tree_guard on public.project_folders;
create trigger project_folders_tree_guard before insert or update of parent_id on public.project_folders
  for each row execute function public.project_folders_tree_guard();

drop trigger if exists project_folders_touch on public.project_folders;
create trigger project_folders_touch before update on public.project_folders
  for each row execute function public.touch_updated_at();

alter table public.project_folders enable row level security;

drop policy if exists "project_folders_select_own" on public.project_folders;
create policy "project_folders_select_own" on public.project_folders
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "project_folders_insert_own" on public.project_folders;
create policy "project_folders_insert_own" on public.project_folders
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "project_folders_update_own" on public.project_folders;
create policy "project_folders_update_own" on public.project_folders
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "project_folders_delete_own" on public.project_folders;
create policy "project_folders_delete_own" on public.project_folders
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects.folder_id
-- ---------------------------------------------------------------------------

alter table public.projects add column if not exists folder_id uuid;

alter table public.projects drop constraint if exists projects_folder_fk;
alter table public.projects add constraint projects_folder_fk
  foreign key (folder_id, user_id) references public.project_folders (id, user_id)
  on delete set null (folder_id);

create index if not exists projects_folder_idx
  on public.projects (user_id, folder_id, updated_at desc) where deleted_at is null;

-- A folder move leaves revision and updated_at as they were; anything else is
-- an edit, touched and bumped exactly as before (FR-21).
create or replace function public.projects_touch_and_bump()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - '{folder_id,updated_at,revision}'::text[])
     = (to_jsonb(old) - '{folder_id,updated_at,revision}'::text[]) then
    new.updated_at = old.updated_at;
    new.revision = old.revision;
    return new;
  end if;
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.projects_touch_and_bump();
