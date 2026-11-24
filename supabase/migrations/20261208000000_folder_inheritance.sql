-- Sean, 23 Nov ("Inheritance & exceptions"): "I picture a ... workspace →
-- client folder → search folder → subfolders for the work." Each level holds
-- facts, requirements and documents that carry down to everything below it:
-- "Someone reviewing a transcript should get the relevant context from the
-- levels above and the instructions for that review." And: "A folder should be
-- able to show what it inherits, where it came from, and what's different here.
-- A more specific folder can replace a default ... A required rule should only
-- change through an explicit exception ... A newer note or a deeper folder
-- shouldn't silently win."
--
-- What this adds:
--   * folders five deep, so workspace › client › search › subfolder fits with
--     room for one more, and a `kind` label on each (workspace, client, search,
--     folder) used only in wording ("Apply exception to this search");
--   * `folder_facts`: a folder's facts and requirements, append-only like
--     `project_facts`. A requirement may be `required`: then nothing below it
--     replaces it (a scoped exception, recorded with who confirmed it and why,
--     is the only way round one; that is the next migration). A deeper
--     folder replaces an ancestor's default only by pointing at it
--     (`overrides`), never by saying something different;
--   * `folder_documents`: a folder's documents (an agreement, a position spec),
--     their text read from the file in the browser, sent with every request of
--     the projects below as passages under the same budget as their own material;
--   * `project_facts.overrides_folder_fact`: a project replacing a default of one
--     of its folders, the same way.
--
-- The backend still owns no data: the browser reads a project's folder chain
-- under RLS and sends what is in force with each request.
--
-- Deleting a folder deletes its rules and documents with it (its projects
-- become Unfiled and its subfolders move to the top, as before). A replacement
-- that pointed at a deleted rule loses its pointer and stands as a plain fact.
--
-- Idempotent: safe to re-run; applies to an empty database.

-- ---------------------------------------------------------------------------
-- Folders: five deep, and a kind
-- ---------------------------------------------------------------------------

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
    if depth > 5 then
      raise exception 'folders go at most five levels deep' using errcode = 'check_violation';
    end if;
    select f.parent_id into cursor_id from public.project_folders f where f.id = cursor_id;
  end loop;
  -- A moved folder takes its subfolders with it: they must still fit.
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    if exists (
      with recursive below as (
        select f.id, 1 as lvl from public.project_folders f where f.parent_id = new.id
        union all
        select f.id, b.lvl + 1 from public.project_folders f join below b on f.parent_id = b.id where b.lvl < 6
      )
      select 1 from below where depth + lvl > 5
    ) then
      raise exception 'folders go at most five levels deep' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter table public.project_folders add column if not exists kind text;
alter table public.project_folders drop constraint if exists project_folders_kind_chk;
alter table public.project_folders add constraint project_folders_kind_chk
  check (kind is null or kind in ('workspace', 'client', 'search', 'folder'));

-- Is `ancestor` a strict ancestor of `folder` (same user)? Used by the checks below.
create or replace function public.folder_is_above(ancestor uuid, folder uuid)
returns boolean
language plpgsql
stable
as $$
declare
  cursor_id uuid;
  hops integer := 0;
begin
  if ancestor is null or folder is null then
    return false;
  end if;
  select f.parent_id into cursor_id from public.project_folders f where f.id = folder;
  while cursor_id is not null and hops < 10 loop
    if cursor_id = ancestor then
      return true;
    end if;
    hops := hops + 1;
    select f.parent_id into cursor_id from public.project_folders f where f.id = cursor_id;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- folder_facts
-- ---------------------------------------------------------------------------

create table if not exists public.folder_facts (
  id             uuid primary key default gen_random_uuid(),
  folder_id      uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  statement      text not null check (char_length(statement) between 1 and 2000),
  subject        text check (subject is null or char_length(subject) <= 200),
  kind           text not null default 'requirement' check (kind in ('fact', 'requirement')),
  -- Nothing below replaces a required rule; only a recorded exception gets round it.
  required       boolean not null default false,
  -- typed into the folder's rules, a note added there, or read from a file.
  source_kind    text not null default 'typed' check (source_kind in ('typed', 'note', 'file')),
  source_ref     jsonb not null default '{}'::jsonb,
  origin         text not null default 'user_stated' check (origin in ('user_stated', 'model_assumed')),
  supersedes     uuid,
  -- An ancestor folder's default this folder replaces, for itself and everything below.
  overrides      uuid,
  retired_at     timestamptz,
  retired_reason text check (retired_reason is null or char_length(retired_reason) <= 500),
  created_at     timestamptz not null default now(),
  constraint folder_facts_id_user_key unique (id, user_id),
  constraint folder_facts_folder_fk foreign key (folder_id, user_id)
    references public.project_folders (id, user_id) on delete cascade,
  constraint folder_facts_required_is_requirement check (not required or kind = 'requirement'),
  constraint folder_facts_not_self check (supersedes is distinct from id and overrides is distinct from id)
);

alter table public.folder_facts drop constraint if exists folder_facts_supersedes_fk;
alter table public.folder_facts add constraint folder_facts_supersedes_fk
  foreign key (supersedes, user_id) references public.folder_facts (id, user_id) on delete cascade;

alter table public.folder_facts drop constraint if exists folder_facts_overrides_fk;
alter table public.folder_facts add constraint folder_facts_overrides_fk
  foreign key (overrides, user_id) references public.folder_facts (id, user_id) on delete set null (overrides);

create index if not exists folder_facts_folder_idx on public.folder_facts (folder_id, created_at);

-- A rule is never edited. Retiring it, once, is the one change; and a
-- replacement whose default was deleted with its folder loses the pointer.
create or replace function public.folder_facts_append_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'overrides') = (to_jsonb(old) - 'overrides')
     and new.overrides is null and old.overrides is not null then
    return new;
  end if;
  if old.retired_at is not null then
    raise exception 'rule % is already retired', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (to_jsonb(new) - '{retired_at,retired_reason}'::text[]) is distinct from (to_jsonb(old) - '{retired_at,retired_reason}'::text[]) then
    raise exception 'a folder rule is never edited; record a new one that supersedes it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_facts_append_only on public.folder_facts;
create trigger folder_facts_append_only before update on public.folder_facts
  for each row execute function public.folder_facts_append_only();

-- Superseding retires the old rule in the same statement. A replacement must
-- name a current default of a folder above this one: never a required rule.
create or replace function public.folder_facts_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
begin
  if new.supersedes is not null then
    update public.folder_facts f
       set retired_at = now(), retired_reason = 'superseded'
     where f.id = new.supersedes and f.folder_id = new.folder_id and f.user_id = new.user_id
       and f.retired_at is null;
    if not found then
      raise exception 'rule % is not a current rule of this folder', new.supersedes using errcode = 'check_violation';
    end if;
  end if;
  if new.overrides is not null then
    select f.* into target from public.folder_facts f where f.id = new.overrides and f.user_id = new.user_id;
    if not found or target.retired_at is not null then
      raise exception 'what this replaces is not a current rule' using errcode = 'check_violation';
    end if;
    if target.required then
      raise exception 'a required rule changes here only through a recorded exception' using errcode = 'check_violation';
    end if;
    if not public.folder_is_above(target.folder_id, new.folder_id) then
      raise exception 'a folder replaces only a rule of a folder above it' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists folder_facts_on_insert on public.folder_facts;
create trigger folder_facts_on_insert after insert on public.folder_facts
  for each row execute function public.folder_facts_on_insert();

alter table public.folder_facts enable row level security;

drop policy if exists "folder_facts_select_own" on public.folder_facts;
create policy "folder_facts_select_own" on public.folder_facts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "folder_facts_insert_own" on public.folder_facts;
create policy "folder_facts_insert_own" on public.folder_facts
  for insert to authenticated with check (user_id = auth.uid());

-- Update only to retire (the trigger allows nothing else). No delete policy:
-- a retired rule stays in the history until its folder is deleted.
drop policy if exists "folder_facts_retire_own" on public.folder_facts;
create policy "folder_facts_retire_own" on public.folder_facts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- folder_documents
-- ---------------------------------------------------------------------------

create table if not exists public.folder_documents (
  id             uuid primary key default gen_random_uuid(),
  folder_id      uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 300),
  text           text not null check (char_length(text) between 1 and 1000000),
  source_ref     jsonb not null default '{}'::jsonb,
  retired_at     timestamptz,
  retired_reason text check (retired_reason is null or char_length(retired_reason) <= 500),
  created_at     timestamptz not null default now(),
  constraint folder_documents_id_user_key unique (id, user_id),
  constraint folder_documents_folder_fk foreign key (folder_id, user_id)
    references public.project_folders (id, user_id) on delete cascade
);

create index if not exists folder_documents_folder_idx on public.folder_documents (folder_id, created_at);

create or replace function public.folder_documents_retire_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'document % is already taken out', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (to_jsonb(new) - '{retired_at,retired_reason}'::text[]) is distinct from (to_jsonb(old) - '{retired_at,retired_reason}'::text[]) then
    raise exception 'a folder document is never edited; add the new one and take this one out' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_documents_retire_only on public.folder_documents;
create trigger folder_documents_retire_only before update on public.folder_documents
  for each row execute function public.folder_documents_retire_only();

alter table public.folder_documents enable row level security;

drop policy if exists "folder_documents_select_own" on public.folder_documents;
create policy "folder_documents_select_own" on public.folder_documents
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "folder_documents_insert_own" on public.folder_documents;
create policy "folder_documents_insert_own" on public.folder_documents
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "folder_documents_retire_own" on public.folder_documents;
create policy "folder_documents_retire_own" on public.folder_documents
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- project_facts.overrides_folder_fact
-- ---------------------------------------------------------------------------

alter table public.project_facts add column if not exists overrides_folder_fact uuid;

alter table public.project_facts drop constraint if exists project_facts_overrides_folder_fk;
alter table public.project_facts add constraint project_facts_overrides_folder_fk
  foreign key (overrides_folder_fact, user_id) references public.folder_facts (id, user_id)
  on delete set null (overrides_folder_fact);

-- A fact is never edited. Retiring it, once, is the one change; and a
-- replacement whose folder default was deleted loses the pointer.
create or replace function public.project_facts_append_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'overrides_folder_fact') = (to_jsonb(old) - 'overrides_folder_fact')
     and new.overrides_folder_fact is null and old.overrides_folder_fact is not null then
    return new;
  end if;
  if old.retired_at is not null then
    raise exception 'fact % is already retired', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (new.id, new.project_id, new.user_id, new.statement, new.subject, new.kind, new.source_kind,
         new.source_ref, new.accepted_by, new.agent_run_id, new.supersedes, new.created_at, new.origin,
         new.overrides_folder_fact)
        is distinct from
        (old.id, old.project_id, old.user_id, old.statement, old.subject, old.kind, old.source_kind,
         old.source_ref, old.accepted_by, old.agent_run_id, old.supersedes, old.created_at, old.origin,
         old.overrides_folder_fact) then
    raise exception 'a fact is never edited; record a new one that supersedes it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- A project replaces only a current default of one of its own folders.
-- Skipped while a project is copied, like the other checks against the
-- present (20261124000000_copy_project.sql).
create or replace function public.project_facts_override_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
  home uuid;
begin
  if new.overrides_folder_fact is null then
    return new;
  end if;
  select f.* into target from public.folder_facts f where f.id = new.overrides_folder_fact and f.user_id = new.user_id;
  if not found or target.retired_at is not null then
    raise exception 'what this replaces is not a current folder rule' using errcode = 'check_violation';
  end if;
  if target.required then
    raise exception 'a required rule changes here only through a recorded exception' using errcode = 'check_violation';
  end if;
  select p.folder_id into home from public.projects p where p.id = new.project_id and p.user_id = new.user_id;
  if home is null or not (home = target.folder_id or public.folder_is_above(target.folder_id, home)) then
    raise exception 'a project replaces only a rule of one of its own folders' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_facts_override_check on public.project_facts;
create trigger project_facts_override_check
  before insert on public.project_facts
  for each row when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on' or current_user in ('authenticated', 'anon'))
  execute function public.project_facts_override_check();
