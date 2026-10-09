-- Q4 (9 Oct): Go may skip an optional stage, within limits the database
-- checks: an authorized autonomous run, routine decisions handed to Go, a
-- stage the pinned template marks optional, and a recorded reason.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/agent_skip_optional_stage.sql
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
  insert into auth.users (id, email) values (u, 'skip-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title, workflow, workflow_template_id, routine_decisions)
    values (proj, u, 'skip test', 'research', tmpl, 'handle');
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run autonomously', 'accepted', '{"kind":"agent_authorization","policy":"autonomous"}')
    returning id into auth_a;
  insert into public.agent_runs (user_id, project_id, policy, authorization_id)
    values (u, proj, 'autonomous', auth_a) returning id into run_a;

  -- 1. An optional stage (Mechanism), with its reason.
  insert into public.workflow_events (user_id, project_id, type, stage_id, to_stage_id, reason, actor, agent_run_id)
    values (u, proj, 'stage_skipped', 'mechanism', 'generality', 'A derivation needs no mechanism stage.', 'system', run_a);

  -- 2. Not a required stage.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, reason, actor, agent_run_id)
      values (u, proj, 'stage_skipped', 'analysis', 'Not needed.', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'Go skipped a required stage'; end if;

  -- 3. Not without a reason.
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, actor, agent_run_id)
      values (u, proj, 'stage_skipped', 'generality', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a skip with no reason was accepted'; end if;

  -- 4. Not when routine decisions are the user's.
  update public.projects set routine_decisions = 'ask' where id = proj;
  failed := false;
  begin
    insert into public.workflow_events (user_id, project_id, type, stage_id, reason, actor, agent_run_id)
      values (u, proj, 'stage_skipped', 'generality', 'Out of scope.', 'system', run_a);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a skip was accepted with routine decisions set to ask'; end if;
end;
$$;

rollback;
