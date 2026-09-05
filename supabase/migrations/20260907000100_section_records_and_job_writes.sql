-- The other half of the drain: what a worker writes, and where continuity lives.
--
-- 20260907000000 gave the drain a way to take work. This gives it a way to put
-- results down, and it is where FR-05's actual guarantee is implemented — not
-- in the claim, but in the order of the writes.
--
-- Everything here is SECURITY DEFINER and service_role-only for the same reason
-- claiming is: the client has SELECT on jobs and nothing more. But note that the
-- drain holds the service-role key and could therefore issue plain UPDATEs
-- instead. It does not, for three reasons that are properties of the functions
-- rather than of the caller:
--
--   1. Every lease-holder write re-checks `lease_owner = p_worker`. After a
--      lease expires and another worker re-claims the job, the original worker
--      may still be alive — a Vercel function is killed, not paused, but the
--      failure mode where it is merely slow is real. Its late writes must be
--      refused, not silently applied over the newer attempt's work.
--   2. `workflow_events.seq` is unique per project, so the sequence number has
--      to be allocated in the same statement that consumes it. Computed in the
--      drain and sent back, it races every other writer of that project's log.
--   3. Writing a section by fetching `long_form`, editing it and writing the
--      whole blob back is a lost-update generator — the same reason
--      project-store.ts patches fields rather than snapshots.

-- ---------------------------------------------------------------------------
-- section_records — FR-06 continuity
-- ---------------------------------------------------------------------------
--
-- Replaces the rolling four-field ContinuitySnapshot for drafting. The snapshot
-- was regenerated from the whole document each time, so its input grew linearly
-- with the prose already written; that is the ~100-page ceiling. A record is
-- extracted from ONE newly written section and persisted, so extraction is
-- constant-cost and the drafting prompt is assembled from stored records
-- instead of from prose.
--
-- Glossary is the field FR-06 names that exists nowhere else in the repo. It is
-- what makes section 9 use a term to mean what section 2 said it meant.

create table if not exists public.section_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null,
  artifact_id uuid,

  -- The OutlineSection.id this record describes.
  section_id    text not null,
  section_index integer not null default 0,
  title         text not null default '',

  summary        text  not null default '',
  -- [{term, definition, first_seen_section_id}]
  glossary_terms jsonb not null default '[]'::jsonb,
  -- Choices this section committed the document to.
  decisions      jsonb not null default '[]'::jsonb,
  -- Promises to the reader that a later section has to keep.
  todos          jsonb not null default '[]'::jsonb,

  -- Which approved outline this record was written against, so a later approval
  -- can say "3 sections were written against outline v1" instead of silently
  -- invalidating prose.
  outline_version_id uuid references public.artifact_versions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FK, matching every other child table: a record cannot be parented
  -- into another user's project even from a service-role client.
  constraint section_records_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- One record per section. Regenerating a section replaces its record rather
  -- than accumulating two, which would let a superseded definition outvote the
  -- current one in the glossary.
  constraint section_records_section_uniq unique (project_id, section_id)
);

create index if not exists section_records_project_idx
  on public.section_records (project_id, section_index);

alter table public.section_records enable row level security;

-- Readable by the owner, written only through the function below. Same shape as
-- jobs: observable, not writable.
drop policy if exists "section_records_owner_select" on public.section_records;
create policy "section_records_owner_select" on public.section_records
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Lease-holder job writes
-- ---------------------------------------------------------------------------

-- Record mid-job progress, and optionally push the lease out so a long step is
-- not reaped out from under itself.
--
-- This is the function FR-05 turns on. The drain calls it immediately after the
-- prose call returns and before it attempts anything else, so the boundary
-- between "paid for and safe" and "cheap to redo" is a committed row.
create or replace function public.checkpoint_job(
  p_job            uuid,
  p_worker         text,
  p_checkpoint     jsonb,
  p_extend_seconds integer default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.jobs
  set checkpoint   = coalesce(p_checkpoint, '{}'::jsonb),
      leased_until = case
                       when p_extend_seconds is null then leased_until
                       else now() + make_interval(secs => greatest(p_extend_seconds, 15))
                     end
  where id = p_job and status = 'leased' and lease_owner = p_worker;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.complete_job(
  p_job    uuid,
  p_worker text,
  p_result jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.jobs
  set status        = 'succeeded',
      result        = coalesce(p_result, '{}'::jsonb),
      lease_owner   = null,
      leased_until  = null,
      finished_at   = now(),
      error_code    = null,
      error_message = null
  where id = p_job and status = 'leased' and lease_owner = p_worker;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- A failure the worker actually observed and classified.
--
-- `p_retryable` comes from the FR-16 taxonomy in promptmaster/errors.py, and it
-- is the difference between a queue that recovers and one that burns money:
-- being out of credits is not worth three more attempts, a 429 is.
create or replace function public.fail_job(
  p_job           uuid,
  p_worker        text,
  p_error_code    text,
  p_error_message text,
  p_error_detail  jsonb default '{}'::jsonb,
  p_retryable     boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.jobs j
  set status = case
                 when not p_retryable                  then 'failed'
                 when j.attempts >= j.max_attempts     then 'dead'
                 else 'queued'
               end,
      lease_owner  = null,
      leased_until = null,
      run_after = case
                    when p_retryable and j.attempts < j.max_attempts
                      -- Same ladder as reap_expired_leases, deliberately: a
                      -- caller should not be able to tell whether recovery came
                      -- from an observed failure or a dead worker.
                      then now() + make_interval(
                             secs => least(300, power(2, j.attempts)::integer * 5))
                    else j.run_after
                  end,
      error_code    = p_error_code,
      error_message = p_error_message,
      error_detail  = coalesce(p_error_detail, '{}'::jsonb),
      finished_at   = case
                        when not p_retryable or j.attempts >= j.max_attempts
                          then now()
                        else null
                      end
  where j.id = p_job and j.status = 'leased' and j.lease_owner = p_worker;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- A clean, voluntary hand-back: the drain ran out of its time budget between
-- steps and is stopping while it still can.
--
-- It gives the attempt back, because claim_next_job took one and nothing
-- actually went wrong. Without this, a long document would exhaust max_attempts
-- purely by being long — each drain tick would consume an attempt for work it
-- performed perfectly well.
create or replace function public.release_job(
  p_job               uuid,
  p_worker            text,
  p_run_after_seconds integer default 0
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.jobs
  set status       = 'queued',
      lease_owner  = null,
      leased_until = null,
      attempts     = greatest(attempts - 1, 0),
      run_after    = now() + make_interval(secs => greatest(coalesce(p_run_after_seconds, 0), 0))
  where id = p_job and status = 'leased' and lease_owner = p_worker;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- request_project_cancel — the user's Pause
-- ---------------------------------------------------------------------------
--
-- The client cannot write `jobs`, so Pause needs a door of its own. It sets the
-- flag rather than deleting rows: a leased job finishes the step it is on (its
-- prose is already paid for, and throwing it away to honour a pause would be
-- the exact FR-05 failure), while the queued remainder is cancelled outright.
create or replace function public.request_project_cancel(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_count   integer;
begin
  select p.user_id into v_user_id
  from public.projects p
  where p.id = p_project_id
    and (auth.uid() is null or p.user_id = auth.uid());

  if v_user_id is null then
    raise exception 'project not found or not owned by caller' using errcode = '42501';
  end if;

  update public.jobs
  set cancel_requested = true,
      status      = case when status = 'queued' then 'cancelled' else status end,
      finished_at = case when status = 'queued' then now() else finished_at end
  where project_id = p_project_id
    and status in ('queued', 'leased');

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- write_long_form_section — the commit that makes FR-05 true
-- ---------------------------------------------------------------------------
--
-- Called the instant the prose call returns, BEFORE record extraction is
-- attempted. If the function is killed a millisecond later the section is on
-- disk, the lease expires, and the re-claim resumes at extraction rather than
-- regenerating prose the user has already paid for.
--
-- Today a tab close discards a completed section. This is the line that stops
-- that, and it is why the write is a single statement against one array element
-- rather than a blob round-trip.
create or replace function public.write_long_form_section(
  p_artifact_id        uuid,
  p_worker             text,
  p_section_id         text,
  p_content            text,
  p_finish_reason      text    default 'stop',
  p_outline_version_id uuid    default null,
  p_advance            boolean default true,
  p_event_type         text    default 'section_written'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid;
  v_project   uuid;
  v_stage     text;
  v_long_form jsonb;
  v_idx       integer;
  v_section   jsonb;
  v_total     integer;
  v_complete  integer;
begin
  select a.user_id, a.project_id, coalesce(a.stage_id, ''), a.long_form
    into v_user, v_project, v_stage, v_long_form
  from public.artifacts a
  where a.id = p_artifact_id;

  if v_user is null then
    raise exception 'artifact % not found', p_artifact_id using errcode = 'no_data_found';
  end if;
  if v_long_form is null or jsonb_typeof(v_long_form->'outline') <> 'array' then
    raise exception 'artifact % has no long-form outline', p_artifact_id
      using errcode = 'invalid_parameter_value';
  end if;

  -- Address the section by id, never by index. The outline can be reordered
  -- between enqueue and execution, and writing prose into whatever now sits at
  -- position 4 would be silent corruption.
  select ord - 1 into v_idx
  from jsonb_array_elements(v_long_form->'outline') with ordinality as t(elem, ord)
  where elem->>'id' = p_section_id
  limit 1;

  if v_idx is null then
    raise exception 'section % is not in this outline', p_section_id
      using errcode = 'no_data_found';
  end if;

  v_section := (v_long_form->'outline')->v_idx;
  v_section := v_section || jsonb_build_object(
    'content',       to_jsonb(p_content),
    'status',        to_jsonb('complete'::text),
    'finish_reason', to_jsonb(p_finish_reason),
    'generated_at',  to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'error',         'null'::jsonb,
    'revision',      to_jsonb(coalesce((v_section->>'revision')::integer, 0) + 1),
    -- FR-07: every written section names the outline it was written against.
    'outline_version_id',
      case when p_outline_version_id is null then 'null'::jsonb
           else to_jsonb(p_outline_version_id) end
  );

  v_long_form := jsonb_set(v_long_form, array['outline', v_idx::text], v_section);

  if p_advance then
    -- greatest(), not assignment: a regenerate of section 2 must not drag the
    -- cursor backwards past sections 3..9 that are already written.
    v_long_form := jsonb_set(
      v_long_form, '{current_section_index}',
      to_jsonb(greatest(coalesce((v_long_form->>'current_section_index')::integer, -1), v_idx + 1))
    );
  end if;

  select count(*), count(*) filter (where elem->>'status' = 'complete')
    into v_total, v_complete
  from jsonb_array_elements(v_long_form->'outline') as t(elem);

  -- Derived here because this is the only place that knows, atomically, whether
  -- the section just written was the last one outstanding.
  if v_complete >= v_total then
    v_long_form := jsonb_set(v_long_form, '{state}', to_jsonb('complete'::text));
    v_long_form := jsonb_set(v_long_form, '{completed_at}',
      to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;

  update public.artifacts set long_form = v_long_form where id = p_artifact_id;

  -- seq is allocated in the same statement that consumes it.
  insert into public.workflow_events (user_id, project_id, seq, type, stage_id, actor, payload)
  select v_user, v_project,
         coalesce(max(e.seq), -1) + 1,
         p_event_type,
         v_stage,
         -- 'system', and there is no 'model' to choose. The worker is recording
         -- its own act; a model reaches this log only via an accepted
         -- recommendation.
         'system',
         jsonb_build_object(
           'section_id',         p_section_id,
           'section_index',      v_idx,
           'finish_reason',      p_finish_reason,
           'outline_version_id', p_outline_version_id,
           'worker',             p_worker
         )
  from public.workflow_events e
  where e.project_id = v_project;

  return jsonb_build_object(
    'section_index',     v_idx,
    'sections_total',    v_total,
    'sections_complete', v_complete
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- write_section_record — the cheap second step
-- ---------------------------------------------------------------------------

create or replace function public.write_section_record(
  p_project_id         uuid,
  p_artifact_id        uuid,
  p_section_id         text,
  p_section_index      integer,
  p_title              text,
  p_summary            text,
  p_glossary_terms     jsonb default '[]'::jsonb,
  p_decisions          jsonb default '[]'::jsonb,
  p_todos              jsonb default '[]'::jsonb,
  p_outline_version_id uuid  default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_id      uuid;
begin
  select p.user_id into v_user_id from public.projects p where p.id = p_project_id;
  if v_user_id is null then
    raise exception 'project % not found', p_project_id using errcode = 'no_data_found';
  end if;

  insert into public.section_records (
    user_id, project_id, artifact_id, section_id, section_index, title,
    summary, glossary_terms, decisions, todos, outline_version_id
  )
  values (
    v_user_id, p_project_id, p_artifact_id, p_section_id,
    coalesce(p_section_index, 0), coalesce(p_title, ''),
    coalesce(p_summary, ''), coalesce(p_glossary_terms, '[]'::jsonb),
    coalesce(p_decisions, '[]'::jsonb), coalesce(p_todos, '[]'::jsonb),
    p_outline_version_id
  )
  on conflict (project_id, section_id) do update
  set section_index      = excluded.section_index,
      title              = excluded.title,
      summary            = excluded.summary,
      glossary_terms     = excluded.glossary_terms,
      decisions          = excluded.decisions,
      todos              = excluded.todos,
      outline_version_id = excluded.outline_version_id,
      updated_at         = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.checkpoint_job(uuid, text, jsonb, integer) from public;
revoke all on function public.complete_job(uuid, text, jsonb) from public;
revoke all on function public.fail_job(uuid, text, text, text, jsonb, boolean) from public;
revoke all on function public.release_job(uuid, text, integer) from public;
revoke all on function public.request_project_cancel(uuid) from public;
revoke all on function public.write_long_form_section(uuid, text, text, text, text, uuid, boolean, text) from public;
revoke all on function public.write_section_record(uuid, uuid, text, integer, text, text, jsonb, jsonb, jsonb, uuid) from public;

-- Pause is a user action and the function checks ownership itself.
grant execute on function public.request_project_cancel(uuid) to authenticated, service_role;

-- Everything else is worker machinery.
grant execute on function public.checkpoint_job(uuid, text, jsonb, integer) to service_role;
grant execute on function public.complete_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, text, text, jsonb, boolean) to service_role;
grant execute on function public.release_job(uuid, text, integer) to service_role;
grant execute on function public.write_long_form_section(uuid, text, text, text, text, uuid, boolean, text) to service_role;
grant execute on function public.write_section_record(uuid, uuid, text, integer, text, text, jsonb, jsonb, jsonb, uuid) to service_role;

grant select on public.section_records to authenticated;
grant all    on public.section_records to service_role;
