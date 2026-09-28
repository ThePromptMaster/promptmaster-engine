-- PM-13: the database rules behind the richer stage statuses.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage_statuses.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u        uuid := gen_random_uuid();
  proj     uuid := gen_random_uuid();
  art_obj  uuid;
  art_aud  uuid;
  ver_obj  uuid;
  failed   boolean;
begin
  insert into auth.users (id, email) values (u, 'status-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'status test');

  insert into public.artifacts (user_id, project_id, kind, name, stage_id)
    values (u, proj, 'output', 'Objective', 'objective') returning id into art_obj;
  insert into public.artifacts (user_id, project_id, kind, name, stage_id)
    values (u, proj, 'output', 'Audience', 'audience') returning id into art_aud;
  insert into public.artifact_versions (user_id, project_id, artifact_id, version_number, source_operation, content)
    values (u, proj, art_obj, 1, 'stage_draft', 'An objective.') returning id into ver_obj;

  -- 1. A block needs a reason…
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, payload)
      values (u, proj, 'stage_blocked', 'objective', '{"block_kind":"data_missing"}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a block without a reason was accepted'; end if;

  -- 2. …and a known kind.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, reason, payload)
      values (u, proj, 'stage_blocked', 'objective', 'waiting on data', '{"block_kind":"vibes"}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a block with an unknown kind was accepted'; end if;

  -- 3. A proper block is accepted.
  insert into public.workflow_events (user_id, project_id, type, stage_id, reason, payload)
    values (u, proj, 'stage_blocked', 'objective', 'waiting on sales figures', '{"block_kind":"data_missing"}');

  -- 4. Evidence from the same stage is accepted.
  insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, payload)
    values (u, proj, 'stage_marked_complete', 'objective', 'audience',
            jsonb_build_object('evidence_version_id', ver_obj));

  -- 5. Evidence claimed for another stage is refused.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, payload)
      values (u, proj, 'stage_marked_complete', 'audience', jsonb_build_object('evidence_version_id', ver_obj));
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'evidence from another stage was accepted'; end if;

  -- 6. Completion with no evidence is still allowed (a stage with nothing to write).
  insert into public.workflow_events (user_id, project_id, type, stage_id)
    values (u, proj, 'stage_marked_complete', 'audience');

  -- 7. The new project events are accepted.
  insert into public.workflow_events (user_id, project_id, type, stage_id) values (u, proj, 'project_finalized', 'audience');
  insert into public.workflow_events (user_id, project_id, type, stage_id) values (u, proj, 'project_reopened', 'audience');
  -- 8. C5: a stage can be reopened by the user…
  insert into public.workflow_events (user_id, project_id, type, stage_id) values (u, proj, 'stage_reopened', 'objective');
  -- 9. …and never by a system actor.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, actor) values (u, proj, 'stage_reopened', 'objective', 'system');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a system actor reopened a stage'; end if;

  raise notice 'stage_statuses: all assertions passed';
end;
$$;

rollback;
