-- Phase 2 M2: workflow templates and the workflow event log.
--
-- FR-03 requires templates to be "stored as configurable data rather than
-- separate hard-coded product paths", and that "a qualified developer or
-- administrator can revise stage definitions through configuration or stored
-- workflow data". That means the definition lives in a row, not in a bundle.
--
-- Templates are IMMUTABLE ONCE PUBLISHED. Revising a workflow inserts a new
-- version; it never mutates a published one. projects.workflow_template_id
-- pins a specific version row, so a book halfway through drafting is
-- unaffected by an admin editing the template underneath it. Without that,
-- "an administrator can revise" and "in-flight work is not corrupted" are
-- mutually exclusive.

create table if not exists public.workflow_templates (
  id      uuid primary key default gen_random_uuid(),
  key     text not null,
  version integer not null,

  status  text not null default 'published',
  -- System templates are seeded by migration and owned by nobody; a user- or
  -- org-authored template would carry an owner_id. RLS below reflects that.
  is_system boolean not null default true,
  owner_id  uuid references auth.users(id) on delete cascade,

  name        text not null,
  description text not null default '',

  -- The full StageDefinition[] plus template-level flags. JSONB rather than
  -- normalized tables: this is read whole, written once, and its shape is
  -- validated by the TypeScript types and the template integrity tests. A
  -- stages table would add joins and migrations for no query we actually run.
  definition jsonb not null,

  supersedes_id uuid references public.workflow_templates(id) on delete set null,

  created_at   timestamptz not null default now(),
  published_at timestamptz,

  constraint wft_key_version_uniq unique (key, version),
  constraint wft_status_chk check (status in ('draft', 'published', 'archived')),
  -- A system template has no owner; a user template must have one.
  constraint wft_owner_chk check (
    (is_system and owner_id is null) or (not is_system and owner_id is not null)
  )
);

create index if not exists wft_key_idx
  on public.workflow_templates (key, version desc) where status = 'published';

alter table public.projects
  add column if not exists workflow_template_id uuid
    references public.workflow_templates(id) on delete set null;

-- ---------------------------------------------------------------------------
-- workflow_events — the record; workflow state is a projection of this
-- ---------------------------------------------------------------------------
--
-- Satisfies three requirements at once: FR-04's completed/skipped stage
-- record, FR-07's "outline approval creates a visible workflow event", and
-- FR-19's workflow-transition logging.

create table if not exists public.workflow_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  seq        bigint not null,

  type     text not null,
  stage_id text not null default '',
  -- Set on transitions, so the projection knows where the cursor moved to.
  to_stage_id text,

  -- As with project_stage_events: no 'model' value. A model reaches the event
  -- log only through an accepted recommendation.
  actor       text not null default 'user',
  reason      text,
  payload     jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint we_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint we_actor_chk check (actor in ('user', 'system')),
  constraint we_type_chk check (type in (
    'project_created', 'stage_entered', 'stage_completed', 'stage_skipped',
    'stage_returned', 'outline_approved', 'outline_version_created',
    'section_written', 'section_regenerated', 'job_enqueued', 'job_failed',
    'generation_paused', 'generation_resumed', 'imported_from_session')),
  -- Mirrors the stage-events rule: a skip without a reason is unrepresentable.
  constraint we_skip_reason_chk check (
    type <> 'stage_skipped' or coalesce(reason, '') <> ''
  )
);

create unique index if not exists we_project_seq_uidx
  on public.workflow_events (project_id, seq);
create index if not exists we_project_idx
  on public.workflow_events (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.workflow_templates enable row level security;
alter table public.workflow_events enable row level security;

-- Every signed-in user can read system templates; a user template is visible
-- only to its owner. Nobody writes templates from the client — new versions
-- arrive by migration, which is what keeps "immutable once published" true.
drop policy if exists "wft_readable" on public.workflow_templates;
create policy "wft_readable" on public.workflow_templates
  for select using (is_system or auth.uid() = owner_id);

-- Append-only, like the other audit tables: no update, no delete.
drop policy if exists "we_owner_select" on public.workflow_events;
create policy "we_owner_select" on public.workflow_events
  for select using (auth.uid() = user_id);
drop policy if exists "we_owner_insert" on public.workflow_events;
create policy "we_owner_insert" on public.workflow_events
  for insert with check (auth.uid() = user_id);
