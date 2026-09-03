-- Phase 2 M1: import legacy sessions into projects/artifacts/versions.
--
-- Runs as pure SQL in a migration rather than as a script, for three reasons:
-- it executes as the migration role so RLS is bypassed for ALL users at once
-- (an anon-key script could only migrate whoever is logged in, and a
-- service-key script means a service key sitting on a laptop); it is atomic;
-- and multi-MB blobs never cross the network.
--
-- Reconnaissance against production before writing this (65 sessions, 8 users):
--   data null/empty ............ 0
--   missing 'iterations' key ... 0
--   'iterations' not a list .... 0
--   total iterations ........... 134
--   iterations with evaluation . 128
--   sessions with long_form .... 10
-- The jsonb_typeof guards below are therefore belt-and-braces rather than
-- load-bearing — but they stay, because this migration may be re-run against
-- data written after that snapshot.
--
-- Idempotent: re-running is a no-op, via projects_legacy_session_uidx plus
-- `on conflict do nothing` on the natural keys.
--
-- Reversible: every row created here carries the same migration_batch uuid.
--   delete from public.projects where migration_batch = '<uuid from the log>';
-- cascades through artifacts -> versions -> evaluations.
--
-- The source `sessions` table is NEVER read destructively and NEVER dropped.
-- It stays a frozen archive for at least a release, so a bad import can be
-- deleted by batch, the migration fixed, and re-run.

-- ---------------------------------------------------------------------------
-- conversation_messages gains project/version pointers (additive)
-- ---------------------------------------------------------------------------
--
-- Today's (session_id, iteration_number) is a stringly-typed composite pointer
-- with no FK — which is exactly why the id bug stayed silent for months:
-- nothing in the database could complain. The legacy columns stay nullable for
-- one release; the FK on version_id is deliberately deferred to a later
-- migration, after confirming zero orphans, because one unmatched row would
-- abort the whole thing.

alter table public.conversation_messages
  add column if not exists project_id uuid,
  add column if not exists version_id uuid;

create index if not exists cm_project_idx
  on public.conversation_messages (project_id, created_at) where project_id is not null;
create index if not exists cm_version_idx
  on public.conversation_messages (version_id, created_at) where version_id is not null;

-- ---------------------------------------------------------------------------
-- The import
-- ---------------------------------------------------------------------------

do $$
declare
  batch          uuid := gen_random_uuid();
  n_sessions     bigint;
  n_projects     bigint;
  n_artifacts    bigint;
  n_versions     bigint;
  n_expected     bigint;
  n_evals        bigint;
  n_msg_matched  bigint;
  n_msg_orphan   bigint;
begin
  select count(*) into n_sessions from public.sessions;

  -- 1. One project per legacy session.
  with inserted as (
    insert into public.projects (
      user_id, title, objective, audience, constraints, output_format,
      mode, model, workflow, stage, status,
      legacy_session_id, migration_batch, created_at
    )
    select
      s.user_id,
      left(nullif(trim(coalesce(s.data->>'objective', s.objective, '')), ''), 120),
      coalesce(s.data->>'objective', s.objective, ''),
      coalesce(nullif(s.data->>'audience', ''), nullif(s.audience, ''), 'General'),
      coalesce(s.data->>'constraints', ''),
      coalesce(s.data->>'output_format', ''),
      coalesce(nullif(s.data->>'mode', ''), nullif(s.mode, ''), 'architect'),
      coalesce(s.data->>'model', ''),
      -- The legacy 5-phase flow becomes a workflow template rather than a
      -- special case (see M2).
      'single_output',
      case when s.finalized then 'summary' else 'output' end,
      case when s.finalized then 'finalized' else 'active' end,
      s.session_id,
      batch,
      coalesce((s.data->>'created_at')::timestamptz, s.created_at, now())
    from public.sessions s
    where not exists (
      select 1 from public.projects p
      where p.user_id = s.user_id and p.legacy_session_id = s.session_id
    )
    returning 1
  )
  select count(*) into n_projects from inserted;

  -- 2. One 'output' artifact per imported project, carrying long_form across.
  with inserted as (
    insert into public.artifacts (user_id, project_id, kind, name, long_form, created_at)
    select p.user_id, p.id, 'output', 'Output',
           case when jsonb_typeof(s.data->'long_form') = 'object' then s.data->'long_form' end,
           p.created_at
    from public.projects p
    join public.sessions s
      on s.user_id = p.user_id and s.session_id = p.legacy_session_id
    where p.migration_batch = batch
      and not exists (
        select 1 from public.artifacts a where a.project_id = p.id and a.kind = 'output'
      )
    returning 1
  )
  select count(*) into n_artifacts from inserted;

  -- Expected version count, for the reconciliation assertion below.
  select coalesce(sum(jsonb_array_length(s.data->'iterations')), 0)
    into n_expected
  from public.sessions s
  join public.projects p
    on p.user_id = s.user_id and p.legacy_session_id = s.session_id and p.migration_batch = batch
  where jsonb_typeof(s.data->'iterations') = 'array';

  -- 3. Iterations -> addressable version rows.
  with inserted as (
    insert into public.artifact_versions (
      user_id, project_id, artifact_id, version_number,
      source_operation, instruction, system_prompt, content, model, mode,
      change_summary, finish_reason, user_rating, continuity_snapshot, created_at
    )
    select
      p.user_id, p.id, a.id,
      -- Trust ordinality over the stored iteration_number: the unique index on
      -- (artifact_id, version_number) must hold, and a malformed blob with a
      -- duplicate number would otherwise abort the import.
      it.ord::int,
      coalesce(nullif(it.value->>'trigger_source', ''), 'initial'),
      coalesce(it.value->>'prompt_sent', ''),
      coalesce(it.value->>'system_prompt_used', ''),
      coalesce(it.value->>'output', ''),
      coalesce(nullif(it.value->>'model_used', ''), coalesce(s.data->>'model', '')),
      coalesce(nullif(it.value->>'mode', ''), coalesce(s.data->>'mode', s.mode, 'architect')),
      nullif(it.value->>'summary', ''),
      nullif(it.value->>'finish_reason', ''),
      case when it.value->>'user_rating' in ('positive', 'negative')
           then it.value->>'user_rating' end,
      case when jsonb_typeof(it.value->'continuity_snapshot') = 'object'
           then it.value->'continuity_snapshot' end,
      coalesce((it.value->>'created_at')::timestamptz, p.created_at)
    from public.projects p
    join public.sessions s
      on s.user_id = p.user_id and s.session_id = p.legacy_session_id
    join public.artifacts a
      on a.project_id = p.id and a.kind = 'output'
    cross join lateral jsonb_array_elements(s.data->'iterations') with ordinality as it(value, ord)
    where p.migration_batch = batch
      and jsonb_typeof(s.data->'iterations') = 'array'
      and jsonb_typeof(it.value) = 'object'
    on conflict (artifact_id, version_number) do nothing
    returning 1
  )
  select count(*) into n_versions from inserted;

  -- 4. Evaluations, where the legacy blob carries a well-formed one. Scores
  -- outside the allowed set are skipped rather than coerced: inventing a score
  -- would be worse than having none.
  with inserted as (
    insert into public.evaluations (
      user_id, project_id, version_id,
      alignment_score, alignment_explanation,
      drift_score, drift_explanation,
      clarity_score, clarity_explanation,
      completeness_status, completeness_reason, interpretation,
      evaluator_model, source, created_at
    )
    select
      v.user_id, v.project_id, v.id,
      ev->'alignment'->>'score', coalesce(ev->'alignment'->>'explanation', ''),
      ev->'drift'->>'score',     coalesce(ev->'drift'->>'explanation', ''),
      ev->'clarity'->>'score',   coalesce(ev->'clarity'->>'explanation', ''),
      ev->'completeness'->>'status', ev->'completeness'->>'reason',
      case when jsonb_typeof(ev->'interpretation') = 'object' then ev->'interpretation' end,
      v.model, 'pipeline', v.created_at
    from public.projects p
    join public.sessions s
      on s.user_id = p.user_id and s.session_id = p.legacy_session_id
    join public.artifacts a on a.project_id = p.id and a.kind = 'output'
    join lateral jsonb_array_elements(s.data->'iterations') with ordinality as it(value, ord) on true
    join public.artifact_versions v
      on v.artifact_id = a.id and v.version_number = it.ord::int
    cross join lateral (select it.value->'evaluation' as ev) e
    where p.migration_batch = batch
      and jsonb_typeof(s.data->'iterations') = 'array'
      and jsonb_typeof(e.ev) = 'object'
      and e.ev->'alignment'->>'score' in ('Low', 'Medium', 'High')
      and e.ev->'drift'->>'score'     in ('Low', 'Medium', 'High')
      and e.ev->'clarity'->>'score'   in ('Low', 'Medium', 'High')
      and not exists (select 1 from public.evaluations x where x.version_id = v.id)
    returning 1
  )
  select count(*) into n_evals from inserted;

  -- 5. Point each artifact at its head version.
  update public.artifacts a
  set current_version_id = latest.id,
      version_count      = latest.n
  from (
    select artifact_id,
           (array_agg(id order by version_number desc))[1] as id,
           count(*) as n
    from public.artifact_versions
    group by artifact_id
  ) latest
  where latest.artifact_id = a.id
    and a.project_id in (select id from public.projects where migration_batch = batch);

  -- 6. Backfill chat pointers where the key was actually written.
  --
  -- Expect this to match only a subset. Messages were written with the store's
  -- sessionId while sessions rows got a fresh random id from the summary
  -- phase, so for those the linking key never existed. Measured before this
  -- migration: 189 of 339 joinable, 150 orphaned across 21 session_ids.
  -- Orphans are LEFT IN PLACE with a null project_id. They are not
  -- recoverable by join — the key was never written — and deleting them would
  -- destroy the only copy of that conversation.
  -- The version lookup is a correlated subquery rather than a join: in
  -- UPDATE ... FROM a JOIN b, the join's ON clause cannot reference the update
  -- target, so `cm.iteration_number` is only legal here.
  with updated as (
    update public.conversation_messages cm
    set project_id = p.id,
        version_id = (
          select v.id
          from public.artifact_versions v
          where v.artifact_id = a.id
            and v.version_number = cm.iteration_number
        )
    from public.projects p
    join public.artifacts a on a.project_id = p.id and a.kind = 'output'
    where p.user_id = cm.user_id
      and p.legacy_session_id = cm.session_id
      and cm.project_id is null
    returning 1
  )
  select count(*) into n_msg_matched from updated;

  select count(*) into n_msg_orphan
  from public.conversation_messages where project_id is null;

  raise notice '--- sessions -> projects import ---';
  raise notice 'migration_batch (undo key): %', batch;
  raise notice 'sessions seen              : %', n_sessions;
  raise notice 'projects created           : %', n_projects;
  raise notice 'artifacts created          : %', n_artifacts;
  raise notice 'versions created           : % (expected %)', n_versions, n_expected;
  raise notice 'evaluations created        : %', n_evals;
  raise notice 'chat messages linked       : %', n_msg_matched;
  raise notice 'chat messages still orphan : %', n_msg_orphan;

  -- Reconciliation. A shortfall means a blob shape this migration does not
  -- understand, i.e. silently dropped user work — abort rather than commit a
  -- partial import.
  if n_versions <> n_expected then
    raise exception
      'Version count mismatch: created %, expected % — aborting rather than '
      'commit a partial import', n_versions, n_expected;
  end if;
end $$;
