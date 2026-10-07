-- F1 (Sean, 6 Oct, emails 4–7): accepted facts and requirements, recorded once.
--
-- "I supplied those figures and explicitly instructed it to update the
-- authoritative candidate facts and all affected stages … the final check
-- classified those same figures as unsupported because they did not appear in
-- the supplied candidate facts." And: "When a fact is added, where is it
-- stored, and how do all downstream stages retrieve the same current value?"
--
-- Until now the answer was: nowhere of its own. Figures given in chat reached
-- later stages only through those stages' text. This table is the record:
-- one row per accepted fact or requirement, with where it came from and who
-- accepted it. Every prompt is sent the current rows (PMInput.facts), so every
-- stage, check and chat reads the same evidence.
--
-- Append-only, like artifact_versions: a changed fact is a new row that
-- supersedes the old one, and the old one is retired by that insert, never
-- edited — so the history of what was accepted, and when, is kept.
--
-- The backend still owns no data: rows are written by the browser under RLS.
--
-- Idempotent: safe to re-run.

create table if not exists public.project_facts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  statement     text not null check (char_length(statement) between 1 and 2000),
  -- What it is about, when that helps ("Candidate B"); optional.
  subject       text check (subject is null or char_length(subject) <= 200),
  kind          text not null default 'fact' check (kind in ('fact', 'requirement')),
  -- Where it came from: typed into the brief's facts, a file, the side chat,
  -- an edit of an earlier fact, or a stage's text.
  source_kind   text not null check (source_kind in ('brief', 'file', 'chat', 'user_edit', 'stage')),
  -- The file id, the chat message, or the stage and version — whatever the
  -- source is, enough to find it again.
  source_ref    jsonb not null default '{}'::jsonb,
  accepted_by   text not null default 'user' check (accepted_by in ('user', 'policy')),
  agent_run_id  uuid references public.agent_runs(id) on delete set null,
  supersedes    uuid references public.project_facts(id),
  retired_at    timestamptz,
  retired_reason text check (retired_reason is null or char_length(retired_reason) <= 500),
  created_at    timestamptz not null default now(),
  constraint project_facts_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- A fact the user supplied is the user's; one PromptMaster accepted under
  -- the routine-decision policy cites the run, and comes only from material
  -- the project holds (a file, a stage) — never from conversation.
  constraint project_facts_acceptance_chk check (
    (accepted_by = 'user' and agent_run_id is null)
    or (accepted_by = 'policy' and agent_run_id is not null and source_kind in ('file', 'stage'))
  )
);

create index if not exists project_facts_project_idx on public.project_facts (project_id, created_at);

alter table public.project_facts enable row level security;

drop policy if exists "project_facts_select_own" on public.project_facts;
create policy "project_facts_select_own" on public.project_facts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "project_facts_insert_own" on public.project_facts;
create policy "project_facts_insert_own" on public.project_facts
  for insert to authenticated with check (user_id = auth.uid());

-- Update only to retire a fact (the trigger below allows nothing else). No
-- delete policy: a retired fact stays in the history.
drop policy if exists "project_facts_retire_own" on public.project_facts;
create policy "project_facts_retire_own" on public.project_facts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A fact is never edited. The one change allowed is retiring it, once.
create or replace function public.project_facts_append_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'fact % is already retired', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (new.id, new.project_id, new.user_id, new.statement, new.subject, new.kind, new.source_kind,
         new.source_ref, new.accepted_by, new.agent_run_id, new.supersedes, new.created_at)
        is distinct from
        (old.id, old.project_id, old.user_id, old.statement, old.subject, old.kind, old.source_kind,
         old.source_ref, old.accepted_by, old.agent_run_id, old.supersedes, old.created_at) then
    raise exception 'a fact is never edited; record a new one that supersedes it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_facts_append_only on public.project_facts;
create trigger project_facts_append_only
  before update on public.project_facts
  for each row execute function public.project_facts_append_only();

-- Superseding: inserting the new fact retires the old one in the same
-- statement, so there is never a moment with both, or neither, current.
-- A policy-accepted fact is checked against the run and the project's policy
-- as they are when it is written.
create or replace function public.project_facts_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run record;
  policy text;
begin
  if new.accepted_by = 'policy' then
    select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
    if not found or run.project_id is distinct from new.project_id or run.user_id is distinct from new.user_id
       or run.status <> 'running' then
      raise exception 'a fact accepted under the routine-decision policy must cite a running run of this project'
        using errcode = 'check_violation';
    end if;
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; facts are the user''s to accept'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.supersedes is not null then
    update public.project_facts f
       set retired_at = now(), retired_reason = 'superseded'
     where f.id = new.supersedes and f.project_id = new.project_id and f.user_id = new.user_id
       and f.retired_at is null;
    if not found then
      raise exception 'fact % is not a current fact of this project', new.supersedes using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_facts_on_insert on public.project_facts;
create trigger project_facts_on_insert
  after insert on public.project_facts
  for each row execute function public.project_facts_on_insert();
