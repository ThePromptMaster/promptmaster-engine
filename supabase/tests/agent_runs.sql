-- Go mode's guarantees (B1): what the database refuses, whatever the client does.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/agent_runs.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u       uuid := gen_random_uuid();
  proj    uuid := gen_random_uuid();
  art     uuid;
  ver     uuid;
  auth_a  uuid;
  auth_c  uuid;
  pending uuid;
  run_a   uuid;
  run_c   uuid;
  run_g   uuid;
  step    uuid;
  sbx     uuid;
  failed  boolean;
begin
  insert into auth.users (id, email) values (u, 'agent-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'agent test');
  insert into public.artifacts (user_id, project_id, kind, name, stage_id)
    values (u, proj, 'output', 'Objective', 'objective') returning id into art;
  insert into public.artifact_versions (user_id, project_id, artifact_id, version_number, source_operation, content)
    values (u, proj, art, 1, 'stage_draft', 'An objective.') returning id into ver;

  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run autonomously', 'accepted', '{"kind":"agent_authorization","policy":"autonomous"}')
    returning id into auth_a;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run with checkpoints', 'accepted', '{"kind":"agent_authorization","policy":"checkpoint"}')
    returning id into auth_c;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Not yet agreed', 'pending', '{"kind":"agent_authorization","policy":"autonomous"}')
    returning id into pending;

  -- 1. Autonomous without an authorization is refused.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy) values (u, proj, 'autonomous');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'autonomous run without authorization was accepted'; end if;

  -- 2. …and so is one citing a proposal the user has not accepted.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id) values (u, proj, 'autonomous', pending);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'autonomous run with a pending authorization was accepted'; end if;

  -- 3. An authorization for another policy does not stretch.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id) values (u, proj, 'autonomous', auth_c);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a checkpoint authorization was accepted for an autonomous run'; end if;

  -- 4. A properly authorized autonomous run may complete a stage WITH evidence…
  insert into public.agent_runs (user_id, project_id, policy, authorization_id)
    values (u, proj, 'autonomous', auth_a) returning id into run_a;
  insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id, payload)
    values (u, proj, 'stage_marked_complete', 'objective', 'audience', 'system', run_a,
            jsonb_build_object('evidence_version_id', ver));

  -- 5. …but not skip a stage (a user decision)…
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, reason, actor, agent_run_id)
      values (u, proj, 'stage_skipped', 'audience', 'agent thought so', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'an agent run skipped a stage'; end if;

  -- 6. …nor finish the project.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, actor, agent_run_id)
      values (u, proj, 'project_finalized', 'audience', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'an agent run finished the project'; end if;

  -- 7. A system-actor stage move with no run behind it is refused outright.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, actor)
      values (u, proj, 'stage_advanced', 'audience', 'system');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a system actor moved stage state without a run'; end if;

  update public.agent_runs set status = 'stopped', ended_at = now() where id = run_a;

  -- 8. Checkpoint may block, but may not advance on its own.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id)
    values (u, proj, 'checkpoint', auth_c) returning id into run_c;
  insert into public.workflow_events (user_id, project_id, type, stage_id, reason, actor, agent_run_id, payload)
    values (u, proj, 'stage_blocked', 'audience', 'needs survey data', 'system', run_c, '{"block_kind":"data_missing"}');
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, actor, agent_run_id)
      values (u, proj, 'stage_advanced', 'audience', 'system', run_c);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a checkpoint run advanced a stage on its own'; end if;
  update public.agent_runs set status = 'stopped', ended_at = now() where id = run_c;

  -- 9. A stopped run is final.
  failed := false;
  begin
    update public.agent_runs set status = 'running' where id = run_c;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a stopped run was restarted'; end if;

  -- 10. Guided needs no authorization, and cannot move stage state at all.
  insert into public.agent_runs (user_id, project_id, policy) values (u, proj, 'guided') returning id into run_g;
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, reason, actor, agent_run_id, payload)
      values (u, proj, 'stage_blocked', 'audience', 'x', 'system', run_g, '{"block_kind":"needs_decision"}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a guided run changed stage state'; end if;

  -- 11. PM-12: a step cannot claim code was executed when none was.
  insert into public.agent_steps (run_id, user_id, project_id, idx, action_key)
    values (run_g, u, proj, 1, 'run_computation') returning id into step;
  failed := false;
  begin
    update public.agent_steps set execution_label = 'code_executed', status = 'succeeded' where id = step;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a step claimed execution with no sandbox run'; end if;

  -- 12. With a real (server-written) run, the same label is accepted…
  insert into public.sandbox_runs (step_id, run_id, user_id, project_id, code, code_sha256, stdout, exit_code, status)
    values (step, run_g, u, proj, 'print(2+2)', 'x', '4', 0, 'ok') returning id into sbx;
  update public.agent_steps set execution_label = 'code_executed', status = 'succeeded' where id = step;

  -- 13. …and a finished step is immutable.
  failed := false;
  begin
    update public.agent_steps set execution_label = 'simulation_run' where id = step;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a finished step was changed'; end if;

  -- 14. Interpreting a result must cite an executed run of this agent run.
  failed := false;
  begin
    insert into public.agent_steps (run_id, user_id, project_id, idx, action_key, execution_label, status)
      values (run_g, u, proj, 2, 'interpret', 'result_interpreted', 'succeeded');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'an interpretation cited no executed run'; end if;
  insert into public.agent_steps (run_id, user_id, project_id, idx, action_key, execution_label, status, params)
    values (run_g, u, proj, 3, 'interpret', 'result_interpreted', 'succeeded', jsonb_build_object('sandbox_run_id', sbx));

  raise notice 'agent_runs: all assertions passed';
end;
$$;

rollback;
