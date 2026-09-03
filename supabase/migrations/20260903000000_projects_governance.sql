-- Phase 2 M1: the governance layer.
--
-- This is where "the model generates, PromptMaster governs" stops being a
-- slogan and becomes a schema. FR-02 requires that the application owns
-- workflow state and that model output may PROPOSE but never silently own a
-- state transition. That is enforced here structurally, not by convention.
--
-- FR-01 unresolved tasks survive a login boundary.
-- FR-02 stage history, skip reasons, and the proposal boundary.
-- FR-05 the jobs table (created now; the drain lands in M3).
--
-- Conventions: idempotent, `drop policy if exists` first, user_id denormalized,
-- composite (id, user_id) FKs so a row cannot be parented into another user's
-- project.

-- ---------------------------------------------------------------------------
-- recommendations — the proposal boundary
-- ---------------------------------------------------------------------------
--
-- Absorbs three things that are ephemeral store fields today: guidance
-- suggestions, audit findings, and setup suggestions. The flow FR-02 demands
-- is: model output -> validated server-side -> inserted here as 'pending' ->
-- the user acts -> a decisions row -> only THEN does application state change.

create table if not exists public.recommendations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  version_id uuid,

  kind     text not null,
  source   text not null default 'system',
  category text,

  title            text not null default '',
  summary          text not null,
  suggested_change text not null default '',

  -- RecommendationRationale: FR-14 wants the triggering issue, the relevant
  -- stage or objective, the expected benefit, and the affected scope.
  rationale jsonb not null default '{}'::jsonb,
  -- The literal text spliced into an apply prompt. Empty means not applyable.
  instruction text not null default '',
  -- Scope + anchor, for applying to a selection or section rather than the
  -- whole document (FR-09).
  scope jsonb not null default '{"kind":"document"}'::jsonb,
  -- Conflict axes (length/depth/tone/...), used for deterministic conflict
  -- detection when several are combined (FR-15).
  tags jsonb not null default '[]'::jsonb,

  severity text not null default 'info',
  status   text not null default 'pending',

  resolved_at          timestamptz,
  resulting_version_id uuid references public.artifact_versions(id) on delete set null,

  source_model text not null default '',
  created_at   timestamptz not null default now(),

  constraint recs_id_user_key unique (id, user_id),
  constraint recs_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint recs_kind_chk check (kind in
    ('quick_action', 'fix', 'workflow', 'coaching', 'restraint', 'setup', 'stage_transition', 'realignment')),
  constraint recs_status_chk check (status in ('pending', 'accepted', 'dismissed', 'superseded')),
  constraint recs_severity_chk check (severity in ('info', 'minor', 'major', 'blocking'))
);

create index if not exists recs_project_idx
  on public.recommendations (project_id, status, created_at desc);
create index if not exists recs_version_idx
  on public.recommendations (version_id, created_at desc) where version_id is not null;

-- ---------------------------------------------------------------------------
-- decisions — the append-only record of what the user chose
-- ---------------------------------------------------------------------------

create table if not exists public.decisions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,

  decision_type     text not null,
  recommendation_id uuid references public.recommendations(id) on delete set null,
  version_id        uuid references public.artifact_versions(id) on delete set null,
  rationale         text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),

  constraint decisions_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint decisions_type_chk check (decision_type in (
    'accept_recommendation', 'dismiss_recommendation', 'restore_version',
    'skip_stage', 'advance_stage', 'return_stage', 'finalize', 'rate_version'))
);

create index if not exists decisions_project_idx
  on public.decisions (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- project_stage_events — FR-02 stage history
-- ---------------------------------------------------------------------------

create table if not exists public.project_stage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  seq        bigint not null,

  from_stage  text,
  to_stage    text not null,
  action      text not null,
  skip_reason text,

  -- Note the absence of 'model'. A model can reach stage state only by way of
  -- proposal_id pointing at an accepted recommendation — there is no code path
  -- from an LLM response to projects.stage. That is the mechanical expression
  -- of FR-02's "model may propose but does not silently own transitions", and
  -- it is auditable from this DDL alone.
  actor       text not null default 'user',
  proposal_id uuid references public.recommendations(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint pse_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint pse_action_chk check (action in ('enter', 'complete', 'skip', 'revert')),
  constraint pse_actor_chk check (actor in ('user', 'system')),
  -- Makes "skipped a stage without saying why" unrepresentable, rather than
  -- relying on a React handler to remember.
  constraint pse_skip_reason_chk check (action <> 'skip' or coalesce(skip_reason, '') <> '')
);

create unique index if not exists pse_project_seq_uidx
  on public.project_stage_events (project_id, seq);
create index if not exists pse_project_idx
  on public.project_stage_events (project_id, created_at);

-- ---------------------------------------------------------------------------
-- project_tasks — FR-01 "unresolved tasks"
-- ---------------------------------------------------------------------------
--
-- Needs its own table: it cannot be derived from recommendations, because a
-- dismissed recommendation is not an open task and a user-authored TODO has no
-- recommendation behind it.

create table if not exists public.project_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,

  title  text not null,
  detail text not null default '',
  stage  text,
  status text not null default 'open',
  origin text not null default 'user',
  origin_recommendation_id uuid references public.recommendations(id) on delete set null,

  created_at  timestamptz not null default now(),
  resolved_at timestamptz,

  constraint tasks_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint tasks_status_chk check (status in ('open', 'done', 'dismissed')),
  constraint tasks_origin_chk check (origin in ('user', 'recommendation', 'evaluation', 'system'))
);

create index if not exists tasks_project_open_idx
  on public.project_tasks (project_id, status, created_at);

-- ---------------------------------------------------------------------------
-- jobs — created now so M3 does not retrofit against live data
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,

  kind     text not null,
  status   text not null default 'queued',
  priority integer not null default 0,

  payload    jsonb not null default '{}'::jsonb,
  -- Written mid-job, before the expensive follow-up step. This is what makes a
  -- section survive a function timeout without regenerating prose the user has
  -- already paid for.
  checkpoint jsonb not null default '{}'::jsonb,
  result     jsonb,

  attempts     integer not null default 0,
  max_attempts integer not null default 3,

  -- Lease, not a lock: a serverless function can be killed without ever
  -- writing a failure, so the lease simply expires and the next drain
  -- re-claims the job.
  lease_owner   text,
  leased_until  timestamptz,
  run_after     timestamptz not null default now(),
  cancel_requested boolean not null default false,

  -- Makes "completed sections are not regenerated unless requested" mechanical:
  -- re-enqueueing a finished unit is a no-op unique violation, while a
  -- user-requested regenerate bumps the revision in the key and so gets a new
  -- row.
  idempotency_key text not null,
  parent_job_id   uuid references public.jobs(id) on delete set null,

  error_code    text,
  error_message text,
  error_detail  jsonb,

  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,

  constraint jobs_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint jobs_status_chk check (status in
    ('queued', 'leased', 'succeeded', 'failed', 'cancelled', 'dead')),
  constraint jobs_idempotency_uniq unique (project_id, idempotency_key)
);

create index if not exists jobs_ready_idx
  on public.jobs (priority desc, run_after) where status = 'queued';
create index if not exists jobs_project_idx
  on public.jobs (project_id, created_at desc);

-- At most one leased job per project. Section N+1's context depends on N's
-- continuity record, so ordering has to be correct by construction rather than
-- by the worker being careful.
create unique index if not exists jobs_one_active_per_project
  on public.jobs (project_id) where status = 'leased';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.recommendations enable row level security;
alter table public.decisions enable row level security;
alter table public.project_stage_events enable row level security;
alter table public.project_tasks enable row level security;
alter table public.jobs enable row level security;

-- recommendations: the user may accept or dismiss (an update), but not delete
-- the record that a proposal was made.
drop policy if exists "recs_owner_select" on public.recommendations;
create policy "recs_owner_select" on public.recommendations
  for select using (auth.uid() = user_id);
drop policy if exists "recs_owner_insert" on public.recommendations;
create policy "recs_owner_insert" on public.recommendations
  for insert with check (auth.uid() = user_id);
drop policy if exists "recs_owner_update" on public.recommendations;
create policy "recs_owner_update" on public.recommendations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- decisions and stage events are the audit trail you would hand someone to
-- prove FR-02. Append-only: no update, no delete.
drop policy if exists "decisions_owner_select" on public.decisions;
create policy "decisions_owner_select" on public.decisions
  for select using (auth.uid() = user_id);
drop policy if exists "decisions_owner_insert" on public.decisions;
create policy "decisions_owner_insert" on public.decisions
  for insert with check (auth.uid() = user_id);

drop policy if exists "pse_owner_select" on public.project_stage_events;
create policy "pse_owner_select" on public.project_stage_events
  for select using (auth.uid() = user_id);
drop policy if exists "pse_owner_insert" on public.project_stage_events;
create policy "pse_owner_insert" on public.project_stage_events
  for insert with check (auth.uid() = user_id);

-- Tasks are ordinary user data.
drop policy if exists "tasks_owner_select" on public.project_tasks;
create policy "tasks_owner_select" on public.project_tasks
  for select using (auth.uid() = user_id);
drop policy if exists "tasks_owner_insert" on public.project_tasks;
create policy "tasks_owner_insert" on public.project_tasks
  for insert with check (auth.uid() = user_id);
drop policy if exists "tasks_owner_update" on public.project_tasks;
create policy "tasks_owner_update" on public.project_tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "tasks_owner_delete" on public.project_tasks;
create policy "tasks_owner_delete" on public.project_tasks
  for delete using (auth.uid() = user_id);

-- Jobs are observable but not writable by the client: the drain worker owns
-- them via the service role. A client that could set status or leased_until
-- could starve or duplicate another tab's work.
drop policy if exists "jobs_owner_select" on public.jobs;
create policy "jobs_owner_select" on public.jobs
  for select using (auth.uid() = user_id);
