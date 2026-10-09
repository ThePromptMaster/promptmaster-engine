-- Q2 (9 Oct): Go may go back to an earlier stage, within limits the database
-- checks: an authorized autonomous run, routine decisions handed to Go, a
-- return the pinned template allows, and a recorded reason.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/agent_return_to_stage.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u       uuid := gen_random_uuid();
  proj    uuid := gen_random_uuid();
  tmpl    uuid;
  auth_a  uuid;
  run_a   uuid;
  failed  boolean;
begin
  select id into tmpl from public.workflow_templates where key = 'research' and is_system order by version desc limit 1;
  if tmpl is null then raise exception 'no research template seeded'; end if;

  insert into auth.users (id, email) values (u, 'return-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title, workflow, workflow_template_id, routine_decisions)
    values (proj, u, 'return test', 'research', tmpl, 'handle');
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run autonomously', 'accepted', '{"kind":"agent_authorization","policy":"autonomous"}')
    returning id into auth_a;
  insert into public.agent_runs (user_id, project_id, policy, authorization_id)
    values (u, proj, 'autonomous', auth_a) returning id into run_a;

  -- 1. Analysis may go back to Experiment, with its reason.
  insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id, payload)
    values (u, proj, 'stage_returned', 'analysis', 'experiment', 'system', run_a,
            '{"agent_return": true, "return_reason": "Run 4 is needed to decide H2."}');

  -- 2. Not without a reason.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id, payload)
      values (u, proj, 'stage_returned', 'analysis', 'experiment', 'system', run_a, '{"agent_return": true}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a return with no reason was accepted'; end if;

  -- 3. Not to a stage the template does not let it return to.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id, payload)
      values (u, proj, 'stage_returned', 'analysis', 'question', 'system', run_a,
              '{"agent_return": true, "return_reason": "Start over."}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a return the template does not allow was accepted'; end if;

  -- 4. Not when routine decisions are the user's.
  update public.projects set routine_decisions = 'ask' where id = proj;
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id, payload)
      values (u, proj, 'stage_returned', 'analysis', 'experiment', 'system', run_a,
              '{"agent_return": true, "return_reason": "Run 4 is needed."}');
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a return was accepted with routine decisions set to ask'; end if;

  -- 5. A plain return citing a run is still refused: going back is otherwise the user's.
  update public.projects set routine_decisions = 'handle' where id = proj;
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, actor, agent_run_id)
      values (u, proj, 'stage_returned', 'analysis', 'experiment', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a return without the agent_return marker was accepted from a run'; end if;
end;
$$;

rollback;
