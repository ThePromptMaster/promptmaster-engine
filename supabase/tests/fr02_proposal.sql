-- FR-02 proposal boundary: does the trigger actually fire?
--
-- THIS REPOSITORY HAS NO SQL TEST HARNESS. There is no pgTAP, no
-- `supabase test db` wiring, and nothing in CI runs this file. The vitest
-- companion (`frontend/src/lib/workflow/proposal-boundary.test.ts`) asserts on
-- the TEXT of the migration — that the column is `on delete restrict`, that the
-- trigger is installed on both history tables, that each of the four
-- rejections is present. That is a real guard against the DDL being weakened
-- by a later edit, and it is NOT a proof that the trigger fires. Only this
-- file is, and running it is currently a manual act.
--
-- Run against a database the migrations have been applied to:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/fr02_proposal.sql
--
-- It creates its own throwaway user and project, asserts, and rolls everything
-- back. Nothing survives it.

begin;

do $$
declare
  test_user  uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  proj       uuid;
  other_proj uuid;
  rec        uuid;
  other_rec  uuid;
  failed     boolean;
begin
  -- --- fixtures ------------------------------------------------------------

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (test_user,  '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'fr02-a@example.test', '', now(), now(), now()),
         (other_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'fr02-b@example.test', '', now(), now(), now());

  insert into public.projects (user_id, title, workflow, stage)
  values (test_user, 'FR-02 fixture', 'book', 'objective')
  returning id into proj;

  insert into public.projects (user_id, title, workflow, stage)
  values (other_user, 'FR-02 other user', 'book', 'objective')
  returning id into other_proj;

  insert into public.recommendations (user_id, project_id, kind, summary, severity, status)
  values (test_user, proj, 'stage_transition', 'Move on to Audience.', 'info', 'pending')
  returning id into rec;

  insert into public.recommendations (user_id, project_id, kind, summary, severity, status)
  values (other_user, other_proj, 'stage_transition', 'Someone else''s proposal.', 'info', 'accepted')
  returning id into other_rec;

  -- --- 1. a proposal that does not exist -----------------------------------

  failed := false;
  begin
    insert into public.workflow_events
      (user_id, project_id, seq, type, stage_id, actor, proposal_id)
    values (test_user, proj, 1, 'stage_completed', 'objective', 'user', gen_random_uuid());
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: an event cited a recommendation that does not exist';
  end if;

  -- --- 2. a proposal belonging to another user -----------------------------

  failed := false;
  begin
    insert into public.workflow_events
      (user_id, project_id, seq, type, stage_id, actor, proposal_id)
    values (test_user, proj, 1, 'stage_completed', 'objective', 'user', other_rec);
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: an event cited another user''s recommendation';
  end if;

  -- --- 3. a proposal that is still pending ---------------------------------
  --
  -- The headline case: the model has proposed and the user has not agreed.

  failed := false;
  begin
    insert into public.workflow_events
      (user_id, project_id, seq, type, stage_id, actor, proposal_id)
    values (test_user, proj, 1, 'stage_completed', 'objective', 'user', rec);
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: an event cited a PENDING recommendation';
  end if;

  -- --- 4. accept it, then retry: the same insert must now succeed ----------

  update public.recommendations set status = 'accepted' where id = rec;

  insert into public.workflow_events
    (user_id, project_id, seq, type, stage_id, actor, proposal_id)
  values (test_user, proj, 1, 'stage_completed', 'objective', 'user', rec);

  if not exists (
    select 1 from public.workflow_events
     where project_id = proj and seq = 1 and proposal_id = rec
  ) then
    raise exception 'FAIL: the accepted proposal''s event was not written';
  end if;

  -- --- 5. actor = 'system' with a proposal_id ------------------------------
  --
  -- Accepted proposal, correct owner, and still refused: a proposal-driven
  -- transition is the USER acting on a suggestion.

  failed := false;
  begin
    insert into public.workflow_events
      (user_id, project_id, seq, type, stage_id, actor, proposal_id)
    values (test_user, proj, 2, 'stage_completed', 'audience', 'system', rec);
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: actor=''system'' owned a transition with a proposal stapled to it';
  end if;

  -- --- 6. an ordinary user transition still needs no proposal --------------

  insert into public.workflow_events
    (user_id, project_id, seq, type, stage_id, actor)
  values (test_user, proj, 2, 'stage_completed', 'audience', 'user');

  -- --- 7. the same rule holds on the dormant table -------------------------

  failed := false;
  begin
    insert into public.project_stage_events
      (user_id, project_id, seq, to_stage, action, actor, proposal_id)
    values (other_user, other_proj, 1, 'audience', 'complete', 'user', rec);
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: project_stage_events accepted another user''s proposal';
  end if;

  -- --- 8. a resolved recommendation cannot be rewritten --------------------

  failed := false;
  begin
    update public.recommendations set instruction = 'something else entirely' where id = rec;
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: an accepted recommendation was rewritten after an event cited it';
  end if;

  -- --- 9. status moves forward only ----------------------------------------

  failed := false;
  begin
    update public.recommendations set status = 'pending' where id = rec;
  exception when check_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: an accepted recommendation was returned to pending';
  end if;

  -- --- 10. the cited recommendation cannot be deleted -----------------------
  --
  -- `on delete restrict`: deleting it would leave the event reading as an
  -- ordinary unprompted transition, which is the one fact the log exists to
  -- keep.

  failed := false;
  begin
    delete from public.recommendations where id = rec;
  exception when foreign_key_violation then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: a recommendation cited by an event was deleted';
  end if;

  raise notice 'FR-02 proposal boundary: all 10 assertions passed';
end;
$$;

rollback;
