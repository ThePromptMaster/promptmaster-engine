-- Go mode: the windows a run starts on its own are held to the authorization.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/agent_run_auto_windows.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u       uuid := gen_random_uuid();
  proj    uuid := gen_random_uuid();
  auth_2  uuid;
  auth_0  uuid;
  auth_9  uuid;
  auth_cp uuid;
  prev    uuid;
  nxt     uuid;
  failed  boolean;
  i       integer;
begin
  insert into auth.users (id, email) values (u, 'auto-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'auto windows test');
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'two on its own', 'accepted', '{"kind":"agent_authorization","policy":"autonomous","auto_continue_windows":2}')
    returning id into auth_2;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'none on its own', 'accepted', '{"kind":"agent_authorization","policy":"autonomous"}')
    returning id into auth_0;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'asks for nine', 'accepted', '{"kind":"agent_authorization","policy":"autonomous","auto_continue_windows":9}')
    returning id into auth_9;
  insert into public.recommendations (user_id, project_id, kind, summary, status, scope)
    values (u, proj, 'workflow', 'checkpoint', 'accepted', '{"kind":"agent_authorization","policy":"checkpoint","auto_continue_windows":2}')
    returning id into auth_cp;

  -- 1. Two allowed: two windows start on their own, the third is refused.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status)
    values (u, proj, 'autonomous', auth_2, 5, 'running') returning id into prev;
  for i in 1..2 loop
    update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'autonomous', auth_2, 5, prev, true) returning id into prev;
  end loop;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'autonomous', auth_2, 5, prev, true);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 1: a third window started on its own under an authorization for two'; end if;

  -- 2. The user's own click is not counted, and starts the count again.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id)
    values (u, proj, 'autonomous', auth_2, 5, prev) returning id into nxt;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = nxt;
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
    values (u, proj, 'autonomous', auth_2, 5, nxt, true) returning id into prev;
  update public.agent_runs set status = 'stopped', ended_at = now() where id = prev;

  -- 3. No allowance in the authorization: none.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status)
    values (u, proj, 'autonomous', auth_0, 5, 'running') returning id into prev;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'autonomous', auth_0, 5, prev, true);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 3: a window started on its own with no allowance'; end if;

  -- 4. An authorization that asks for nine gets three.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status)
    values (u, proj, 'autonomous', auth_9, 5, 'running') returning id into prev;
  for i in 1..3 loop
    update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'autonomous', auth_9, 5, prev, true) returning id into prev;
  end loop;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'autonomous', auth_9, 5, prev, true);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 4: a fourth window started on its own'; end if;

  -- 5. Only Autonomous continues on its own, and only as a continuation.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, status)
    values (u, proj, 'checkpoint', auth_cp, 5, 'running') returning id into prev;
  update public.agent_runs set status = 'budget_exhausted', ended_at = now() where id = prev;
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id, auto_continued)
      values (u, proj, 'checkpoint', auth_cp, 5, prev, true);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 5a: a checkpoint run continued on its own'; end if;
  failed := false;
  begin
    insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, auto_continued)
      values (u, proj, 'autonomous', auth_2, 5, true);
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 5b: a first window was marked as started on its own'; end if;

  -- 6. The mark is fixed once written.
  insert into public.agent_runs (user_id, project_id, policy, authorization_id, budget_steps, continues_run_id)
    values (u, proj, 'checkpoint', auth_cp, 5, prev) returning id into nxt;
  failed := false;
  begin
    update public.agent_runs set auto_continued = true where id = nxt;
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 6: auto_continued could be changed'; end if;

  raise notice 'agent_run_auto_windows: all tests passed';
end $$;

rollback;
