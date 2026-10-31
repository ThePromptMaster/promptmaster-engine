-- 31 Oct: make a copy of a project, and keep the original.
--
-- The ask: "should it be more like a copy thing rather than combining them so
-- you have the original project too as well kind of like the versions". A
-- copy is a new project of the same user holding everything the original
-- holds at that moment — its versions, chapters, facts, sources, files, side
-- chat, stage history and Go's record — under new ids. Nothing in the original
-- is changed, and nothing in the copy points back into it.
--
-- How. Every row of the project is read as jsonb, every id in it that belongs
-- to the project (its own id, a version's, a fact's, a run's …) is swapped for
-- the copy's id for that row, and the row is written back. Ids inside jsonb
-- payloads (an event's evidence_version_id, an outline's version, a section's
-- record) are swapped the same way, so the copy's history cites the copy.
--
-- What is checked again, and what is not. Foreign keys, the version
-- event sequence, evidence citations, accepted proposals and run
-- authorizations are all checked on the copy's rows as on any write. Four
-- triggers are not run, because they judge a row against the present rather
-- than against what it records: the version numbering, which would make each
-- version's parent the head at the moment of copying rather than the version
-- it was made from (artifact_versions_assign_number; the head itself still
-- moves, artifact_versions_move_head), that an event a Go run wrote was written by a run
-- that is running *now* (workflow_events_agent_authorized), that a fact
-- accepted under the routine-decision policy cites a running run and retires
-- the fact it supersedes *now* (project_facts_on_insert), and that a step
-- labelled "code executed" has its sandbox run already written
-- (agent_steps_label_honest — the run row cites the step, so one of the two
-- comes first). Each is skipped only while `promptmaster.copying` is 'on',
-- which this function sets for its own transaction and clears; a client
-- cannot set a database setting through the API.
--
-- A later migration that recreates one of those four triggers must keep its
-- WHEN clause, or copying fails loudly; `copy-project-triggers.test.ts` checks.

-- What is not copied: jobs (work in flight), model_usage and error_events
-- (telemetry of what the original cost), setup_drafts and beta_feedback. A Go
-- run copied while it was running is recorded as stopped. Stored files are
-- copied by the browser afterwards; the function returns the pairs of paths.

drop trigger if exists workflow_events_agent_authorized on public.workflow_events;
create trigger workflow_events_agent_authorized
  before insert on public.workflow_events
  for each row when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on')
  execute function public.workflow_events_agent_authorized();

drop trigger if exists project_facts_on_insert on public.project_facts;
create trigger project_facts_on_insert
  after insert on public.project_facts
  for each row when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on')
  execute function public.project_facts_on_insert();

drop trigger if exists artifact_versions_assign_number on public.artifact_versions;
create trigger artifact_versions_assign_number
  before insert on public.artifact_versions
  for each row when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on')
  execute function public.artifact_versions_assign_number();

drop trigger if exists agent_steps_label_honest on public.agent_steps;
create trigger agent_steps_label_honest
  before insert or update on public.agent_steps
  for each row when (coalesce(current_setting('promptmaster.copying', true), '') <> 'on')
  execute function public.agent_steps_label_honest();

create or replace function public.copy_project_remap(j jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  txt text := j::text;
  m record;
begin
  -- Only the uuids this row holds are looked up, so a long version costs one
  -- regex scan, not one replace per id in the project.
  for m in
    select distinct x[1] as old_id
    from regexp_matches(txt, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') as x
  loop
    txt := replace(txt, m.old_id, coalesce((select c.new_id from pg_temp.copy_project_map c where c.old_id = m.old_id), m.old_id));
  end loop;
  return txt::jsonb;
end;
$$;

revoke all on function public.copy_project_remap(jsonb) from public, anon, authenticated;

create or replace function public.copy_project(src uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  dst uuid := gen_random_uuid();
  -- Children, each after everything it references. Tables that do not exist
  -- yet are passed over.
  tables text[] := array[
    'artifacts', 'artifact_versions', 'recommendations', 'decisions',
    'agent_runs', 'agent_steps', 'sandbox_runs', 'evaluations', 'section_records',
    'workflow_events', 'project_stage_events', 'project_tasks',
    'project_facts', 'project_sources', 'project_files', 'project_references',
    'conversation_messages'
  ];
  overrides jsonb;
  t text;
  cols text;
  ord text;
  files jsonb := '[]'::jsonb;
  artifacts jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'sign in to copy a project' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = src and p.user_id = uid and p.deleted_at is null) then
    raise exception 'project % is not yours to copy', src using errcode = '42501';
  end if;

  create temp table if not exists copy_project_map (old_id text primary key, new_id text not null) on commit drop;
  truncate pg_temp.copy_project_map;
  insert into pg_temp.copy_project_map values (src::text, dst::text);

  -- Every id the project's rows carry gets its copy's id first, so a row can
  -- point at one written after it.
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format(
      'insert into pg_temp.copy_project_map select id::text, gen_random_uuid()::text from public.%I where project_id = $1 on conflict do nothing', t
    ) using src;
  end loop;

  perform set_config('promptmaster.copying', 'on', true);

  -- The project itself: a new title, a fresh revision, and nothing that ties
  -- it to the original's import or deletion.
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a
  where a.attrelid = 'public.projects'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attgenerated = '' and a.attidentity <> 'a';
  execute format(
    'insert into public.projects (%1$s) select %1$s from ('
    || 'select (jsonb_populate_record(null::public.projects, public.copy_project_remap(to_jsonb(p)) || jsonb_build_object('
    || '''title'', left(p.title, 190) || '' (copy)'', ''revision'', 0, ''legacy_session_id'', null, ''migration_batch'', null, '
    || '''archived_at'', null, ''deleted_at'', null, ''created_at'', now(), ''updated_at'', now()))).* '
    || 'from public.projects p where p.id = $1) s', cols
  ) using src;

  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- Columns a client may write: never a generated one, nor an identity
    -- column the database numbers itself (project_sources.seq, renumbered in
    -- the original's order below).
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity <> 'a';
    -- Versions keep their numbers and parents; the database moves each
    -- artifact's head to its newest, so an artifact starts with none.
    overrides := case t when 'artifacts' then jsonb_build_object('current_version_id', null, 'version_count', 0) else '{}'::jsonb end;
    ord := case
      when t = 'artifact_versions' then 'version_number'
      when exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'seq' and not attisdropped) then 'seq'
      when exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'created_at' and not attisdropped) then 'created_at'
      else 'id' end;
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from ('
      || 'select (jsonb_populate_record(null::public.%1$I, public.copy_project_remap(to_jsonb(r)) || $2)).* '
      || 'from public.%1$I r where r.project_id = $1 order by r.%3$I) s', t, cols, ord
    ) using src, overrides;
  end loop;

  -- A run copied mid-step is not running in the copy.
  if to_regclass('public.agent_runs') is not null then
    update public.agent_runs
       set status = 'stopped', ended_at = coalesce(ended_at, now()), lease_holder = null,
           stop_reason = coalesce(stop_reason, 'The project was copied while this run was going.')
     where project_id = dst and ended_at is null;
  end if;

  perform set_config('promptmaster.copying', 'off', true);

  -- The stored objects the browser copies: each old path and the copy's.
  select coalesce(jsonb_agg(jsonb_build_object('bucket', 'project-files', 'from', f.path,
           'to', public.copy_project_remap(to_jsonb(f.path)) #>> '{}')), '[]'::jsonb)
    into files
  from public.project_files f where f.project_id = src;
  if to_regclass('public.sandbox_runs') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('bucket', 'sandbox-artifacts', 'from', a->>'path',
             'to', public.copy_project_remap(to_jsonb(a->>'path')) #>> '{}')), '[]'::jsonb)
      into artifacts
    from public.sandbox_runs s, jsonb_array_elements(coalesce(s.artifacts, '[]'::jsonb)) a
    where s.project_id = src and coalesce(a->>'path', '') <> '';
  end if;

  return jsonb_build_object('project_id', dst, 'objects', files || artifacts);
end;
$$;

revoke all on function public.copy_project(uuid) from public, anon;
grant execute on function public.copy_project(uuid) to authenticated;
