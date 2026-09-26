-- ===========================================================================
-- Go mode: agent runs, their steps, and executed code (PM-12, PM-15, PM-17..20)
-- ===========================================================================
--
-- Sean, Sep 10: "go" means "read the current state; determine the best expert
-- next move; actually perform that move; update the state; choose the next
-- move; continue until genuinely blocked or until a meaningful decision
-- requires me", with three execution policies — Guided, Checkpoint,
-- Autonomous — and one rule above the rest: "PromptMaster should never imply
-- an action happened when it only reasoned about that action."
--
-- The loop runs in the browser; this migration is what makes its record
-- trustworthy regardless of what the browser does:
--
--   agent_runs     one Go session. Checkpoint and Autonomous require an
--                  accepted user authorization (a recommendation of scope kind
--                  'agent_authorization'); at most one run per project runs.
--   agent_steps    one action each, with an execution label. A step can be
--                  labelled code_executed / simulation_run only if a sandbox run
--                  exists for it — the honesty rule is enforced here, not hoped
--                  for in the client.
--   sandbox_runs   executed code and its real output. Owners may read; only
--                  the server (service role) writes, so a browser cannot forge
--                  an execution.
--
-- And the FR-02 boundary, extended rather than weakened: a system-actor stage
-- event must cite a running agent run whose accepted authorization allows it.
-- The existing proposal trigger (20260909000000) is untouched.

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

create table if not exists public.agent_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  project_id       uuid not null,
  policy           text not null,
  status           text not null default 'running',
  stop_reason      text,
  authorization_id uuid references public.recommendations(id) on delete restrict,
  budget_steps     integer not null default 12,
  budget_usd       numeric(10, 4),
  steps_used       integer not null default 0,
  cost_usd         numeric(10, 4) not null default 0,
  lease_holder     text,
  heartbeat_at     timestamptz,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz,

  constraint agent_runs_id_user_key unique (id, user_id),
  constraint agent_runs_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint agent_runs_policy_chk check (policy in ('guided', 'checkpoint', 'autonomous')),
  constraint agent_runs_status_chk check (status in (
    'running', 'awaiting_decision', 'blocked', 'completed', 'budget_exhausted', 'stopped', 'failed')),
  -- Continuing on its own needs the user's say-so, on the record.
  constraint agent_runs_authorized_chk check (policy = 'guided' or authorization_id is not null),
  constraint agent_runs_budget_chk check (budget_steps between 1 and 100)
);

create unique index if not exists agent_runs_one_running_per_project
  on public.agent_runs (project_id) where status = 'running';
create index if not exists agent_runs_project_idx on public.agent_runs (project_id, created_at desc);

create or replace function public.agent_runs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  rec record;
begin
  if tg_op = 'INSERT' then
    if new.authorization_id is not null then
      select r.status, r.user_id, r.scope into rec from public.recommendations r where r.id = new.authorization_id;
      if not found or rec.user_id is distinct from new.user_id or rec.status <> 'accepted'
         or rec.scope->>'kind' is distinct from 'agent_authorization'
         or rec.scope->>'policy' is distinct from new.policy then
        raise exception 'agent run authorization must be an accepted agent_authorization for policy % by the same user', new.policy
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- What was authorized cannot be changed after the fact.
  if new.policy is distinct from old.policy or new.authorization_id is distinct from old.authorization_id
     or new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id then
    raise exception 'an agent run''s policy, authorization and project are fixed' using errcode = 'check_violation';
  end if;
  -- Terminal statuses are final.
  if old.status in ('completed', 'budget_exhausted', 'stopped', 'failed') and new.status is distinct from old.status then
    raise exception 'agent run % has ended (%); start a new run', old.id, old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_runs_guard on public.agent_runs;
create trigger agent_runs_guard
  before insert or update on public.agent_runs
  for each row execute function public.agent_runs_guard();

-- ---------------------------------------------------------------------------
-- agent_steps
-- ---------------------------------------------------------------------------

create table if not exists public.agent_steps (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null,
  user_id           uuid not null references auth.users(id) on delete cascade,
  project_id        uuid not null,
  idx               integer not null,
  stage_id          text not null default '',
  mode              text not null default '',
  action_key        text not null,
  params            jsonb not null default '{}'::jsonb,
  rationale         text not null default '',
  expected_outcome  text not null default '',
  needs_decision    boolean not null default false,
  decision_question text,
  status            text not null default 'running',
  execution_label   text,
  block_kind        text,
  tools_used        text[] not null default '{}',
  changes           jsonb not null default '{}'::jsonb,
  output            text not null default '',
  cost_usd          numeric(10, 4),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  constraint agent_steps_run_fk foreign key (run_id, user_id)
    references public.agent_runs (id, user_id) on delete cascade,
  constraint agent_steps_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint agent_steps_run_idx_key unique (run_id, idx),
  constraint agent_steps_status_chk check (status in (
    'running', 'succeeded', 'failed', 'blocked', 'awaiting_decision', 'cancelled', 'interrupted')),
  -- PM-12's distinctions, verbatim from Sean's list.
  constraint agent_steps_label_chk check (execution_label is null or execution_label in (
    'discussed', 'designed', 'code_written', 'code_executed', 'simulation_run', 'result_interpreted', 'blocked')),
  constraint agent_steps_block_kind_chk check (block_kind is null or block_kind in (
    'tool_missing', 'data_missing', 'needs_decision'))
);

create index if not exists agent_steps_run_idx on public.agent_steps (run_id, idx);

-- ---------------------------------------------------------------------------
-- sandbox_runs
-- ---------------------------------------------------------------------------

create table if not exists public.sandbox_runs (
  id          uuid primary key default gen_random_uuid(),
  step_id     uuid not null references public.agent_steps(id) on delete cascade,
  run_id      uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null,
  language    text not null default 'python',
  code        text not null,
  code_sha256 text not null,
  stdout      text not null default '',
  stderr      text not null default '',
  truncated   boolean not null default false,
  exit_code   integer,
  timed_out   boolean not null default false,
  duration_ms integer,
  artifacts   jsonb not null default '[]'::jsonb,
  status      text not null,
  cost_usd    numeric(10, 4),
  created_at  timestamptz not null default now(),

  constraint sandbox_runs_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint sandbox_runs_status_chk check (status in ('ok', 'error', 'timeout', 'unavailable'))
);

create index if not exists sandbox_runs_step_idx on public.sandbox_runs (step_id);

-- A step's label is what happened, checked against what happened.
create or replace function public.agent_steps_label_honest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('succeeded', 'failed', 'blocked', 'cancelled', 'interrupted') then
    raise exception 'agent step % is finished and cannot change', old.id using errcode = 'check_violation';
  end if;

  if new.execution_label in ('code_executed', 'simulation_run') and not exists (
    select 1 from public.sandbox_runs s
    where s.step_id = new.id and s.exit_code is not null and not s.timed_out and s.status in ('ok', 'error')
  ) then
    raise exception 'step % is labelled % but no code was executed for it', new.id, new.execution_label
      using errcode = 'check_violation';
  end if;

  if new.execution_label = 'result_interpreted' and not exists (
    select 1 from public.sandbox_runs s
    where s.id::text = new.params->>'sandbox_run_id' and s.run_id = new.run_id and s.exit_code is not null
  ) then
    raise exception 'step % interprets a result, but cites no executed run of this agent run', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists agent_steps_label_honest on public.agent_steps;
create trigger agent_steps_label_honest
  before insert or update on public.agent_steps
  for each row execute function public.agent_steps_label_honest();

-- ---------------------------------------------------------------------------
-- workflow_events: system-actor stage moves must come from an authorized run
-- ---------------------------------------------------------------------------

alter table public.workflow_events
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete restrict;

create or replace function public.workflow_events_agent_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run record;
  auth_ok boolean;
begin
  -- Skipping, going back, finishing, reopening and upgrading are the user's
  -- decisions, whatever policy is running.
  if new.type in ('stage_skipped', 'stage_returned', 'project_finalized', 'project_reopened', 'template_upgraded')
     and (new.actor <> 'user' or new.agent_run_id is not null) then
    raise exception '% is a user decision; an agent run cannot record it', new.type using errcode = 'check_violation';
  end if;

  if new.agent_run_id is null then
    -- A system actor moving stage state without a run behind it is the shape
    -- FR-02 forbids. (The drain's section_written is not a stage move.)
    if new.actor = 'system' and new.type in (
         'stage_completed', 'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked', 'stage_entered') then
      raise exception 'a system-actor % must cite an authorized agent run', new.type using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.actor <> 'system' then
    raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
  end if;

  select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
  if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id then
    raise exception 'agent run % is not a run of this project', new.agent_run_id using errcode = 'check_violation';
  end if;
  if run.status <> 'running' then
    raise exception 'agent run % is %, not running', run.id, run.status using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.recommendations r
    where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
      and r.scope->>'kind' = 'agent_authorization'
  ) into auth_ok;

  -- What each policy may do on its own.
  if run.policy = 'autonomous' and auth_ok
     and (new.type in ('stage_advanced', 'stage_blocked')
          or (new.type = 'stage_marked_complete' and new.payload ? 'evidence_version_id')) then
    return new;
  end if;
  if run.policy = 'checkpoint' and auth_ok and new.type = 'stage_blocked' then
    return new;
  end if;

  raise exception 'a % run may not record % on its own', run.policy, new.type using errcode = 'check_violation';
end;
$$;

drop trigger if exists workflow_events_agent_authorized on public.workflow_events;
create trigger workflow_events_agent_authorized
  before insert on public.workflow_events
  for each row execute function public.workflow_events_agent_authorized();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.sandbox_runs enable row level security;

drop policy if exists "agent_runs_owner_select" on public.agent_runs;
create policy "agent_runs_owner_select" on public.agent_runs for select using (auth.uid() = user_id);
drop policy if exists "agent_runs_owner_insert" on public.agent_runs;
create policy "agent_runs_owner_insert" on public.agent_runs for insert with check (auth.uid() = user_id);
drop policy if exists "agent_runs_owner_update" on public.agent_runs;
create policy "agent_runs_owner_update" on public.agent_runs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "agent_steps_owner_select" on public.agent_steps;
create policy "agent_steps_owner_select" on public.agent_steps for select using (auth.uid() = user_id);
drop policy if exists "agent_steps_owner_insert" on public.agent_steps;
create policy "agent_steps_owner_insert" on public.agent_steps for insert with check (auth.uid() = user_id);
drop policy if exists "agent_steps_owner_update" on public.agent_steps;
create policy "agent_steps_owner_update" on public.agent_steps for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Read-only to owners: executions are written by the server alone.
drop policy if exists "sandbox_runs_owner_select" on public.sandbox_runs;
create policy "sandbox_runs_owner_select" on public.sandbox_runs for select using (auth.uid() = user_id);

grant select, insert, update on public.agent_runs to authenticated;
grant select, insert, update on public.agent_steps to authenticated;
grant select on public.sandbox_runs to authenticated;
grant all on public.agent_runs, public.agent_steps, public.sandbox_runs to service_role;
