-- Phase 2 M1: persistent projects, artifacts, and addressable versions.
--
-- Replaces the single ephemeral session (a Zustand store in sessionStorage,
-- flushed into one opaque sessions.data JSONB blob) with real rows.
--
-- FR-01 projects survive refresh, logout and a different browser session.
-- FR-10 versions are addressable and restorable, with provenance.
-- FR-17 user isolation is enforced structurally, not by convention.
-- FR-20 deletion is recoverable before it is permanent.
-- FR-21 concurrent edits are detected rather than silently lost.
--
-- Conventions (see CLAUDE.md): idempotent, `drop policy if exists` before
-- `create policy`, user_id denormalized onto every table so RLS stays one
-- index-friendly predicate.

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- Bumps revision alongside updated_at. The revision counter is what makes
-- optimistic concurrency work (FR-21), and it must be owned by the database:
-- if a client could set it, a stale writer would just send its stale value
-- back and the guard would pass.
create or replace function public.touch_and_bump_revision()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  title         text not null default 'Untitled project',
  objective     text not null default '',
  audience      text not null default 'General',
  constraints   text not null default '',
  output_format text not null default '',

  mode            text not null default 'architect',
  custom_name     text not null default '',
  custom_preamble text not null default '',
  custom_tone     text not null default '',

  model              text not null default '',
  session_facts      jsonb not null default '[]'::jsonb,
  active_stack_id    text,
  constraint_presets jsonb not null default '[]'::jsonb,
  format_presets     jsonb not null default '[]'::jsonb,

  -- Workflow cursor. Deliberately unconstrained text: in M2 the set of valid
  -- stages becomes template-defined data, so a CHECK here would guarantee a
  -- follow-up migration. The workflow engine validates transitions.
  workflow text not null default 'single_output',
  stage    text not null default 'input',
  status   text not null default 'active',

  -- FR-21
  revision bigint not null default 0,

  -- FR-20: soft delete first, hard delete on a schedule. A user-triggered
  -- cascade with no undo is the wrong default for someone's book manuscript.
  archived_at timestamptz,
  deleted_at  timestamptz,

  -- Migration bookkeeping. legacy_session_id makes the sessions->projects
  -- import idempotent; migration_batch makes a whole run reversible with one
  -- delete.
  legacy_session_id text,
  migration_batch   uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Referenced by every child table's composite FK; see the note on artifacts.
  constraint projects_id_user_key unique (id, user_id),
  constraint projects_status_chk check (status in ('active', 'finalized', 'archived'))
);

create index if not exists projects_user_idx
  on public.projects (user_id, updated_at desc) where deleted_at is null;

create unique index if not exists projects_legacy_session_uidx
  on public.projects (user_id, legacy_session_id) where legacy_session_id is not null;

create index if not exists projects_migration_batch_idx
  on public.projects (migration_batch) where migration_batch is not null;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_and_bump_revision();

-- ---------------------------------------------------------------------------
-- artifacts
-- ---------------------------------------------------------------------------

create table if not exists public.artifacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,

  kind text not null default 'output',
  name text not null default 'Output',

  current_version_id uuid,
  version_count      integer not null default 0,

  -- LongFormState verbatim. Kept as JSONB on purpose: the outline mutates on
  -- nearly every step of generation, so normalizing it would turn one row
  -- write into an N-row diff per section for no contract benefit. The contract
  -- wants versions of *artifacts*, and this artifact's versions are the
  -- finalized merged documents.
  long_form jsonb,

  revision   bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint artifacts_id_user_key unique (id, user_id),
  -- Composite FK, not a plain project_id reference. This makes it
  -- structurally impossible to attach an artifact to another user's project —
  -- even from a service-role client or a buggy backend that forgot a filter.
  -- RLS protects reads; this protects writes. Together they are the FR-17
  -- mechanism.
  constraint artifacts_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade
);

create index if not exists artifacts_project_idx on public.artifacts (project_id, created_at);

drop trigger if exists artifacts_touch on public.artifacts;
create trigger artifacts_touch before update on public.artifacts
  for each row execute function public.touch_and_bump_revision();

-- ---------------------------------------------------------------------------
-- artifact_versions — the FR-10 unit, and the replacement for Iteration[]
-- ---------------------------------------------------------------------------

create table if not exists public.artifact_versions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null,
  artifact_id uuid not null,

  version_number    integer not null,
  parent_version_id uuid references public.artifact_versions(id) on delete set null,

  -- FR-10 requires each of these: "timestamp, source operation, instruction or
  -- recommendation, model, and a change summary or comparison".
  source_operation text not null default 'initial',
  instruction      text not null default '',
  system_prompt    text not null default '',
  content          text not null,
  model            text not null default '',
  mode             text not null default '',
  change_summary   text,

  -- Restore is an append, never a mutation: restoring version k onto head n
  -- inserts n+1 carrying k's content. Nothing is lost, restore is itself
  -- undoable, and version_number stays linear — which matters because the
  -- whole existing UI and the backend's session-history formatting assume it.
  restored_from_version_id uuid references public.artifact_versions(id) on delete set null,

  finish_reason       text,
  user_rating         text,
  continuity_snapshot jsonb,

  created_at timestamptz not null default now(),

  constraint av_id_user_key unique (id, user_id),
  constraint av_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint av_artifact_fk foreign key (artifact_id, user_id)
    references public.artifacts (id, user_id) on delete cascade,
  constraint av_rating_chk check (user_rating is null or user_rating in ('positive', 'negative'))
);

create unique index if not exists av_artifact_version_uidx
  on public.artifact_versions (artifact_id, version_number);

create index if not exists av_project_idx
  on public.artifact_versions (project_id, created_at desc);

-- artifacts.current_version_id is added after the table exists (circular ref).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'artifacts_current_version_fk'
  ) then
    alter table public.artifacts
      add constraint artifacts_current_version_fk
      foreign key (current_version_id) references public.artifact_versions(id) on delete set null;
  end if;
end $$;

-- Versions are immutable. user_rating is the one legitimate mutation (a user
-- rating a past version); everything else changing is a bug. Enforced here
-- rather than left to convention, because the correctness of restore, of
-- version history, and of the prompt-assembly that reads that history all
-- depend on content never changing under them.
create or replace function public.artifact_versions_immutable()
returns trigger language plpgsql as $$
begin
  if to_jsonb(new) - 'user_rating' is distinct from to_jsonb(old) - 'user_rating' then
    raise exception
      'artifact_versions rows are immutable (only user_rating may change); '
      'to change content, append a new version';
  end if;
  return new;
end;
$$;

drop trigger if exists artifact_versions_no_update on public.artifact_versions;
create trigger artifact_versions_no_update before update on public.artifact_versions
  for each row execute function public.artifact_versions_immutable();

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------

create table if not exists public.evaluations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  version_id uuid not null,

  -- Flattened rather than a JSONB EvaluationResult: scores are what you filter
  -- and aggregate on ("show me projects with drift High").
  alignment_score       text not null,
  alignment_explanation text not null default '',
  drift_score           text not null,
  drift_explanation     text not null default '',
  clarity_score         text not null,
  clarity_explanation   text not null default '',

  completeness_status text,
  completeness_reason text,
  interpretation      jsonb,
  findings            jsonb not null default '[]'::jsonb,

  -- Mirrors EvaluationResult.needs_realignment. CLAUDE.md says use the
  -- property rather than re-deriving the condition; a stored generated column
  -- is the SQL-side equivalent of that property, not a third copy of the rule.
  needs_realignment boolean generated always as
    (alignment_score = 'Low' or drift_score = 'High') stored,

  evaluator_model text not null default '',
  source          text not null default 'pipeline',
  created_at      timestamptz not null default now(),

  constraint eval_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint eval_version_fk foreign key (version_id, user_id)
    references public.artifact_versions (id, user_id) on delete cascade,
  constraint eval_scores_chk check (
    alignment_score in ('Low', 'Medium', 'High')
    and drift_score in ('Low', 'Medium', 'High')
    and clarity_score in ('Low', 'Medium', 'High')
  ),
  constraint eval_source_chk check (source in ('pipeline', 'restored', 'manual'))
);

create index if not exists eval_version_idx on public.evaluations (version_id, created_at desc);
create index if not exists eval_project_idx on public.evaluations (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.evaluations enable row level security;

-- projects: full CRUD for the owner. Delete stays available for FR-20, though
-- the app should prefer setting deleted_at.
drop policy if exists "projects_owner_select" on public.projects;
create policy "projects_owner_select" on public.projects
  for select using (auth.uid() = user_id);
drop policy if exists "projects_owner_insert" on public.projects;
create policy "projects_owner_insert" on public.projects
  for insert with check (auth.uid() = user_id);
drop policy if exists "projects_owner_update" on public.projects;
create policy "projects_owner_update" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "projects_owner_delete" on public.projects;
create policy "projects_owner_delete" on public.projects
  for delete using (auth.uid() = user_id);

drop policy if exists "artifacts_owner_select" on public.artifacts;
create policy "artifacts_owner_select" on public.artifacts
  for select using (auth.uid() = user_id);
drop policy if exists "artifacts_owner_insert" on public.artifacts;
create policy "artifacts_owner_insert" on public.artifacts
  for insert with check (auth.uid() = user_id);
drop policy if exists "artifacts_owner_update" on public.artifacts;
create policy "artifacts_owner_update" on public.artifacts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "artifacts_owner_delete" on public.artifacts;
create policy "artifacts_owner_delete" on public.artifacts
  for delete using (auth.uid() = user_id);

-- artifact_versions is append-only: no delete policy at all. Rows go away only
-- by project cascade, or by the service role during an FR-20 hard delete. The
-- update policy exists solely so a user can rate a version; the immutability
-- trigger narrows it to that single column.
drop policy if exists "artifact_versions_owner_select" on public.artifact_versions;
create policy "artifact_versions_owner_select" on public.artifact_versions
  for select using (auth.uid() = user_id);
drop policy if exists "artifact_versions_owner_insert" on public.artifact_versions;
create policy "artifact_versions_owner_insert" on public.artifact_versions
  for insert with check (auth.uid() = user_id);
drop policy if exists "artifact_versions_owner_rate" on public.artifact_versions;
create policy "artifact_versions_owner_rate" on public.artifact_versions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- evaluations are a record of what was judged, so they are append-only too.
drop policy if exists "evaluations_owner_select" on public.evaluations;
create policy "evaluations_owner_select" on public.evaluations
  for select using (auth.uid() = user_id);
drop policy if exists "evaluations_owner_insert" on public.evaluations;
create policy "evaluations_owner_insert" on public.evaluations
  for insert with check (auth.uid() = user_id);
