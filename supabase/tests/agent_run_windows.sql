-- Go mode windows (B4): a run continues only a used-up run of the same
-- project, policy and authorization; `needs` is free to change while live.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/agent_run_windows.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u        uuid := gen_random_uuid();
  u2       uuid := gen_random_uuid();
  proj     uuid := gen_random_uuid();
  proj2    uuid := gen_random_uuid();
  auth_a   uuid;
  auth_b   uuid;
  used_up  uuid;
  stopped  uuid;
  cont     uuid;
  failed   boolean;
begin
  insert into auth.users (id, email) values (u, 'win-' || u || '@promptmaster.test');
  insert into auth.users (id, email) values (u2, 'win2-' || u2 || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'windows test');
  insert into public.projects (id, user_id, title) values (proj2, u, 'other project');
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run with checkpoints', 'accepted', '{"kind":"agent_authorization","policy":"checkpoint"}')
    returning id into auth_a;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'Run with checkpoints, again', 'accepted', '{"kind":"agent_authorization","policy":"checkpoint"}')
    returning id into auth_b;

  -- A window used up, and one the user stopped.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status, needs)
    values (u, proj, 'checkpoint', auth_a, 5, 'running', '{"kind":"continue_budget","budgetSteps":5}')
    returning id into used_up;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = used_up;
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status)
    values (u, proj, 'checkpoint', auth_a, 5, 'running') returning id into stopped;
  update public.agent_runs set status = 'stopped', ended_at = now() where id = stopped;

  -- 1. Continuing the used-up run, same policy and authorization: allowed.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id)
    values (u, proj, 'checkpoint', auth_a, 5, used_up) returning id into cont;

  -- 2. The lineage is fixed once written.
  failed := false;
  begin
    update public.agent_runs set continues_run_id = null where id = cont;
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 2: continues_run_id could be changed'; end if;

  -- 3. Continuing a stopped run: refused.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id)
      values (u, proj, 'checkpoint', auth_a, 5, stopped);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 3: a stopped run could be continued'; end if;

  -- 4. Continuing under a different authorization: refused.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id)
      values (u, proj, 'checkpoint', auth_b, 5, used_up);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 4: a different authorization could continue the run'; end if;

  -- 5. Continuing from another project: refused.
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, budget_steps, continues_run_id)
      values (u, proj2, 'guided', 5, used_up);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 5: another project could continue the run'; end if;

  -- 6. `needs` changes freely while the run is live, and is kept when it ends.
  update public.agent_runs set needs = '{"kind":"approve_outline","stageId":"outline","versionNumber":1,"unsavedDraft":false}' where id = cont;
  update public.agent_runs set status = 'awaiting_decision' where id = cont;
  update public.agent_runs set needs = null, status = 'running' where id = cont;
  update public.agent_runs set status = 'stopped', ended_at = now(), needs = '{"kind":"continue_budget","budgetSteps":5}' where id = cont;
  if (select needs->>'kind' from public.agent_runs where id = cont) <> 'continue_budget' then
    raise exception 'test 6: needs was not kept with the ended run';
  end if;

  raise notice 'agent_run_windows: 6 assertions passed';
end $$;

rollback;
