-- W3 (Sean, 20 Oct): "Can we add web search and source retrieval to research
-- workflows, with citations and saved sources? On and off button?"
--
-- Two things the database holds:
-- - `projects.web_access`: the project's switch, off by default. Only the user
--   changes it, and each change is recorded as `web_access_changed` in
--   workflow_events (actor user, never a run), like routine_policy_changed.
-- - `project_sources`: what a web search returned, one row per source, with
--   when it was retrieved and what was searched. Append-only like
--   project_facts: a source is never edited; the one change allowed is
--   retiring it, once. Stages cite the current rows as [S1], [S2], ….
--
-- The backend still owns no data: rows are written by the browser under RLS.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists web_access text not null default 'off';
alter table public.projects drop constraint if exists projects_web_access_chk;
alter table public.projects add constraint projects_web_access_chk check (web_access in ('off', 'on'));

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
  'stage_version_saved', 'web_access_changed'));

alter table public.workflow_events drop constraint if exists we_web_access_user_chk;
alter table public.workflow_events add constraint we_web_access_user_chk check (
  type <> 'web_access_changed'
  or (actor = 'user' and agent_run_id is null and payload->>'web_access' in ('off', 'on'))
);

create table if not exists public.project_sources (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  url           text not null check (url ~ '^https?://' and char_length(url) <= 2000),
  title         text not null default '' check (char_length(title) <= 300),
  -- What the search returned from the page; not the page itself.
  excerpt       text not null default '' check (char_length(excerpt) <= 600),
  query         text not null check (char_length(query) between 1 and 400),
  -- The stage the search was made from, if any.
  stage_id      text check (stage_id is null or char_length(stage_id) <= 80),
  provider      text not null default 'openrouter_web' check (provider in ('openrouter_web')),
  -- A search the user ran, or one Go ran (citing its run).
  origin        text not null default 'user' check (origin in ('user', 'agent')),
  agent_run_id  uuid references public.agent_runs(id) on delete set null,
  retrieved_at  timestamptz not null default now(),
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint project_sources_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint project_sources_origin_chk check (
    (origin = 'user' and agent_run_id is null) or (origin = 'agent' and agent_run_id is not null)
  )
);

create index if not exists project_sources_project_idx on public.project_sources (project_id, created_at);

alter table public.project_sources enable row level security;

drop policy if exists "project_sources_select_own" on public.project_sources;
create policy "project_sources_select_own" on public.project_sources
  for select to authenticated using (user_id = auth.uid());

-- A source is saved only while the project's switch is on.
drop policy if exists "project_sources_insert_own" on public.project_sources;
create policy "project_sources_insert_own" on public.project_sources
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid() and p.web_access = 'on')
  );

-- Update only to retire a source (the trigger below allows nothing else). No
-- delete policy: a retired source stays in the history.
drop policy if exists "project_sources_retire_own" on public.project_sources;
create policy "project_sources_retire_own" on public.project_sources
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.project_sources_append_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'source % is already retired', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (new.id, new.project_id, new.user_id, new.url, new.title, new.excerpt, new.query, new.stage_id,
         new.provider, new.origin, new.agent_run_id, new.retrieved_at, new.created_at)
        is distinct from
        (old.id, old.project_id, old.user_id, old.url, old.title, old.excerpt, old.query, old.stage_id,
         old.provider, old.origin, old.agent_run_id, old.retrieved_at, old.created_at) then
    raise exception 'a source is never edited; it can only be retired' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_sources_append_only on public.project_sources;
create trigger project_sources_append_only
  before update on public.project_sources
  for each row execute function public.project_sources_append_only();
