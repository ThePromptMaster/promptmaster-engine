-- Sean, 23 Nov ("Inheritance & exceptions"), continued from 20261208000000:
-- "say the client folder says the client handles references, but a consultant
-- adds a note saying [the firm] is handling them on this search. I'd want
-- PromptMaster to surface both and offer something like Apply exception to this
-- search. That would record who confirmed it and why. The next search would
-- still start with the client's usual arrangement. If the two instructions are
-- still in conflict, pause the reference work that depends on the answer and let
-- the rest of the search continue."
--
-- `folder_conflicts`: a rule a folder hands down and something said lower down
-- (a deeper folder's rule, or a project's fact) that cannot both hold, each with
-- the words that disagree, found in them. Recorded when the check finds it; open
-- until one side is taken out or changed, an exception or replacement links the
-- two, or the user says it is not a mismatch. Whether one is open is worked out
-- in the browser from those rows, never stored as a status.
--
-- `folder_exceptions`: the user's decision that a rule does not apply in one
-- place (a folder and everything below it, or one project), with what applies
-- there instead, who authorised it, how that was confirmed and why. Required
-- rules change only this way. Revoked by retiring it; never edited.
--
-- `workflow_events` gains two kinds the browser records for a project:
--   inherited_checked: which of its facts were read against which folder rules;
--   inherited_hold: which of its stages wait on a mismatch, each with the words
--     of the stage that show it, and which the user released.
--
-- Idempotent: safe to re-run; applies to an empty database.

-- A project fact can be named by (id, user_id), so a conflict can cite it.
-- Added only when missing: a re-run must not drop it from under the key that cites it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_facts_id_user_key') then
    alter table public.project_facts add constraint project_facts_id_user_key unique (id, user_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- folder_exceptions
-- ---------------------------------------------------------------------------

create table if not exists public.folder_exceptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Where it applies: a folder (and everything below it) or one project.
  folder_id      uuid,
  project_id     uuid,
  -- The rule it sets aside there.
  rule_id        uuid not null,
  -- What applies there instead.
  statement      text not null check (char_length(btrim(statement)) between 1 and 2000),
  authorised_by  text not null check (char_length(btrim(authorised_by)) between 2 and 200),
  how_confirmed  text not null check (char_length(btrim(how_confirmed)) between 4 and 500),
  reason         text not null check (char_length(btrim(reason)) between 4 and 1000),
  -- The note that raised it, when one did: { kind, id, statement }.
  from_note      jsonb not null default '{}'::jsonb,
  retired_at     timestamptz,
  retired_reason text check (retired_reason is null or char_length(retired_reason) <= 500),
  created_at     timestamptz not null default now(),
  constraint folder_exceptions_one_scope check (num_nonnulls(folder_id, project_id) = 1),
  constraint folder_exceptions_folder_fk foreign key (folder_id, user_id)
    references public.project_folders (id, user_id) on delete cascade,
  constraint folder_exceptions_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint folder_exceptions_rule_fk foreign key (rule_id, user_id)
    references public.folder_facts (id, user_id) on delete cascade
);

create index if not exists folder_exceptions_folder_idx on public.folder_exceptions (folder_id) where folder_id is not null;
create index if not exists folder_exceptions_project_idx on public.folder_exceptions (project_id) where project_id is not null;
create index if not exists folder_exceptions_rule_idx on public.folder_exceptions (rule_id);

-- An exception is to a current rule of a folder above where it applies.
create or replace function public.folder_exceptions_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule record;
  home uuid;
begin
  select f.* into rule from public.folder_facts f where f.id = new.rule_id and f.user_id = new.user_id;
  if not found or rule.retired_at is not null then
    raise exception 'an exception is to a current folder rule' using errcode = 'check_violation';
  end if;
  if new.folder_id is not null then
    if not public.folder_is_above(rule.folder_id, new.folder_id) then
      raise exception 'an exception applies in a folder below the rule''s own' using errcode = 'check_violation';
    end if;
  else
    select p.folder_id into home from public.projects p where p.id = new.project_id and p.user_id = new.user_id;
    if home is null or not (home = rule.folder_id or public.folder_is_above(rule.folder_id, home)) then
      raise exception 'an exception applies to a project filed under the rule''s folder' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists folder_exceptions_on_insert on public.folder_exceptions;
create trigger folder_exceptions_on_insert before insert on public.folder_exceptions
  for each row execute function public.folder_exceptions_on_insert();

-- Never edited; revoked once.
create or replace function public.folder_exceptions_retire_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'exception % is already revoked', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (to_jsonb(new) - '{retired_at,retired_reason}'::text[]) is distinct from (to_jsonb(old) - '{retired_at,retired_reason}'::text[]) then
    raise exception 'an exception is never edited; revoke it and record a new one' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_exceptions_retire_only on public.folder_exceptions;
create trigger folder_exceptions_retire_only before update on public.folder_exceptions
  for each row execute function public.folder_exceptions_retire_only();

alter table public.folder_exceptions enable row level security;

drop policy if exists "folder_exceptions_select_own" on public.folder_exceptions;
create policy "folder_exceptions_select_own" on public.folder_exceptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "folder_exceptions_insert_own" on public.folder_exceptions;
create policy "folder_exceptions_insert_own" on public.folder_exceptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "folder_exceptions_retire_own" on public.folder_exceptions;
create policy "folder_exceptions_retire_own" on public.folder_exceptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- folder_conflicts
-- ---------------------------------------------------------------------------

create table if not exists public.folder_conflicts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  -- The rule from above.
  upper_fact_id         uuid not null,
  -- What disagrees with it: a deeper folder's rule, or a project's fact.
  lower_folder_fact_id  uuid,
  lower_project_fact_id uuid,
  upper_quote           text not null check (char_length(upper_quote) between 1 and 600),
  lower_quote           text not null check (char_length(lower_quote) between 1 and 600),
  explanation           text not null default '' check (char_length(explanation) <= 600),
  dismissed_at          timestamptz,
  created_at            timestamptz not null default now(),
  constraint folder_conflicts_one_lower check (num_nonnulls(lower_folder_fact_id, lower_project_fact_id) = 1),
  constraint folder_conflicts_upper_fk foreign key (upper_fact_id, user_id)
    references public.folder_facts (id, user_id) on delete cascade,
  constraint folder_conflicts_lower_folder_fk foreign key (lower_folder_fact_id, user_id)
    references public.folder_facts (id, user_id) on delete cascade,
  constraint folder_conflicts_lower_project_fk foreign key (lower_project_fact_id, user_id)
    references public.project_facts (id, user_id) on delete cascade
);

create unique index if not exists folder_conflicts_pair_uidx on public.folder_conflicts
  (upper_fact_id, coalesce(lower_folder_fact_id, lower_project_fact_id));
create index if not exists folder_conflicts_lower_project_idx on public.folder_conflicts (lower_project_fact_id) where lower_project_fact_id is not null;
create index if not exists folder_conflicts_lower_folder_idx on public.folder_conflicts (lower_folder_fact_id) where lower_folder_fact_id is not null;
create index if not exists folder_conflicts_upper_idx on public.folder_conflicts (upper_fact_id);

-- Only the user's "not a mismatch" changes a row, once.
create or replace function public.folder_conflicts_dismiss_only()
returns trigger
language plpgsql
as $$
begin
  if old.dismissed_at is not null or new.dismissed_at is null
     or (to_jsonb(new) - 'dismissed_at') is distinct from (to_jsonb(old) - 'dismissed_at') then
    raise exception 'a mismatch is only ever dismissed, once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_conflicts_dismiss_only on public.folder_conflicts;
create trigger folder_conflicts_dismiss_only before update on public.folder_conflicts
  for each row execute function public.folder_conflicts_dismiss_only();

alter table public.folder_conflicts enable row level security;

drop policy if exists "folder_conflicts_select_own" on public.folder_conflicts;
create policy "folder_conflicts_select_own" on public.folder_conflicts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "folder_conflicts_insert_own" on public.folder_conflicts;
create policy "folder_conflicts_insert_own" on public.folder_conflicts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "folder_conflicts_dismiss_own" on public.folder_conflicts;
create policy "folder_conflicts_dismiss_own" on public.folder_conflicts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- workflow_events: inherited_checked, inherited_hold
-- ---------------------------------------------------------------------------

alter table public.workflow_events drop constraint if exists we_type_chk;
alter table public.workflow_events add constraint we_type_chk check (type in (
  'project_created', 'stage_entered', 'stage_completed', 'stage_skipped',
  'stage_returned', 'outline_approved', 'outline_version_created',
  'section_written', 'section_regenerated', 'job_enqueued', 'job_failed',
  'generation_paused', 'generation_resumed', 'imported_from_session',
  'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked',
  'project_finalized', 'project_reopened', 'template_upgraded', 'stage_reopened',
  'revision_refused', 'routine_policy_changed', 'criterion_committed',
  'brief_changed', 'brief_change_dismissed', 'objective_assessed',
  'stage_version_saved', 'web_access_changed', 'stage_added', 'workflow_switched',
  'criterion_not_applicable', 'approval_left_to_go', 'inherited_checked', 'inherited_hold'));

-- A hold names its mismatch; neither kind is ever written by a run.
alter table public.workflow_events drop constraint if exists we_inherited_chk;
alter table public.workflow_events add constraint we_inherited_chk check (
  type not in ('inherited_checked', 'inherited_hold')
  or (agent_run_id is null and (type <> 'inherited_hold' or payload ? 'conflict_id'))
);
