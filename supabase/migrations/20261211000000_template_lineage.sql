-- Sean, 23 Nov ("Inheritance & exceptions"): "Workspace: ... shared prompts and editable
-- templates for things like contracts, transcript reviews, and candidate reports ... A
-- client could also have its own templates ... Copy and edit templates at any level. Show
-- which version a copy came from. If the master changes later, show what changed and let
-- the team choose whether to apply it to an active search."
--
-- `workflow_templates.copied_from_id`: the version a copy was made from, or last brought
-- up to date with. A copy is its own key; editing it, or taking the master's changes into
-- it, publishes the next version of that key, and the projects pinned to it are offered
-- the new version on their own page as before (nothing is re-pinned without a press).
--
-- `workflow_templates_lineage`: a user's next version of a key must be theirs and the
-- next number. Until now any user could insert a row under another user's key and take
-- its next version number.
--
-- `folder_templates`: which workflows a folder offers to everything below it.
--
-- `folder_documents.is_template`: a document kept as a template (a contract, a report
-- layout), offered to the projects below as their standard to match.
-- `projects.sample_source`: which document a project's standard came from, so a newer
-- one can be offered.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.workflow_templates add column if not exists copied_from_id uuid;
alter table public.workflow_templates drop constraint if exists wft_copied_from_fk;
alter table public.workflow_templates add constraint wft_copied_from_fk
  foreign key (copied_from_id) references public.workflow_templates (id) on delete set null;

create or replace function public.workflow_templates_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  latest record;
  source record;
begin
  if new.is_system then
    return new;
  end if;
  select t.owner_id, t.version into latest
    from public.workflow_templates t where t.key = new.key order by t.version desc limit 1;
  if found then
    if latest.owner_id is distinct from new.owner_id then
      raise exception 'workflow % belongs to someone else', new.key using errcode = 'check_violation';
    end if;
    if new.version <> latest.version + 1 then
      raise exception 'the next version of % is %', new.key, latest.version + 1 using errcode = 'check_violation';
    end if;
  end if;
  if new.copied_from_id is not null then
    select t.is_system, t.owner_id into source from public.workflow_templates t where t.id = new.copied_from_id;
    if not found or not (source.is_system or source.owner_id = new.owner_id) then
      raise exception 'a copy is made from a workflow its owner can read' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_templates_lineage on public.workflow_templates;
create trigger workflow_templates_lineage before insert on public.workflow_templates
  for each row execute function public.workflow_templates_lineage();

-- A published row changes only in whether it is listed; and its copy pointer may be
-- cleared when the row it pointed at is deleted.
create or replace function public.workflow_templates_listing_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - '{listed,status,copied_from_id}'::text[]) is distinct from (to_jsonb(old) - '{listed,status,copied_from_id}'::text[])
     or (new.copied_from_id is distinct from old.copied_from_id and new.copied_from_id is not null) then
    raise exception 'A published workflow cannot be changed; only whether it is listed (status, listed).'
      using errcode = 'check_violation';
  end if;
  if old.status = 'draft' or new.status = 'draft' then
    raise exception 'A workflow is listed or archived, never returned to draft.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- folder_templates
-- ---------------------------------------------------------------------------

create table if not exists public.folder_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  folder_id    uuid not null,
  template_key text not null check (char_length(template_key) between 1 and 200),
  removed_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint folder_templates_folder_fk foreign key (folder_id, user_id)
    references public.project_folders (id, user_id) on delete cascade
);

create unique index if not exists folder_templates_once_uidx on public.folder_templates (folder_id, template_key) where removed_at is null;

create or replace function public.folder_templates_remove_only()
returns trigger
language plpgsql
as $$
begin
  if old.removed_at is not null or new.removed_at is null
     or (to_jsonb(new) - 'removed_at') is distinct from (to_jsonb(old) - 'removed_at') then
    raise exception 'a folder template is only ever taken out, once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_templates_remove_only on public.folder_templates;
create trigger folder_templates_remove_only before update on public.folder_templates
  for each row execute function public.folder_templates_remove_only();

alter table public.folder_templates enable row level security;

drop policy if exists "folder_templates_select_own" on public.folder_templates;
create policy "folder_templates_select_own" on public.folder_templates
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "folder_templates_insert_own" on public.folder_templates;
create policy "folder_templates_insert_own" on public.folder_templates
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "folder_templates_remove_own" on public.folder_templates;
create policy "folder_templates_remove_own" on public.folder_templates
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Document templates
-- ---------------------------------------------------------------------------

alter table public.folder_documents add column if not exists is_template boolean not null default false;
alter table public.projects add column if not exists sample_source jsonb;
