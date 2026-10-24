-- A user may publish a workflow of their own, and only that (20261012000000),
-- and take it off the start screen's list and back (20261113000000).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/user_workflow_templates.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u      uuid := gen_random_uuid();
  other  uuid := gen_random_uuid();
  failed boolean;
  def    jsonb := '{"outline_stage":"none","stages":[]}';
begin
  insert into auth.users (id, email) values (u, 'wft-' || u || '@promptmaster.test'), (other, 'wft-' || other || '@promptmaster.test');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Their own custom_ template, published: allowed, and readable back.
  insert into public.workflow_templates (key, version, name, definition, status, is_system, owner_id)
    values ('custom_test_' || replace(u::text, '-', ''), 1, 'Mine', def, 'published', false, u);
  if not exists (select 1 from public.workflow_templates where owner_id = u) then
    raise exception 'test 1: an own template could not be read back';
  end if;

  -- 2. Not a system template, not a system key, not someone else's, not a draft.
  failed := false;
  begin
    insert into public.workflow_templates (key, version, name, definition, status, is_system, owner_id)
      values ('book', 99, 'Shadow', def, 'published', false, u);
  exception when insufficient_privilege or check_violation then failed := true; end;
  if not failed then raise exception 'test 2a: a user template shadowed a system key'; end if;
  failed := false;
  begin
    insert into public.workflow_templates (key, version, name, definition, status, is_system, owner_id)
      values ('custom_x_' || replace(u::text, '-', ''), 1, 'Theirs', def, 'published', false, other);
  exception when insufficient_privilege or check_violation then failed := true; end;
  if not failed then raise exception 'test 2b: a template was published for another user'; end if;
  failed := false;
  begin
    insert into public.workflow_templates (key, version, name, definition, status, is_system, owner_id)
      values ('custom_s_' || replace(u::text, '-', ''), 1, 'Sys', def, 'published', true, null);
  exception when insufficient_privilege or check_violation then failed := true; end;
  if not failed then raise exception 'test 2c: a user published a system template'; end if;

  -- 3. Immutable once published: its content cannot change (20261113000000
  --    lets the owner change only status and listed, and refuses the rest).
  failed := false;
  begin
    update public.workflow_templates set name = 'Changed' where owner_id = u;
  exception when check_violation then failed := true; end;
  if not failed or exists (select 1 from public.workflow_templates where owner_id = u and name = 'Changed') then
    raise exception 'test 3: a published template was changed';
  end if;

  -- 4. The owner may take it off the list and put it back (Sean, 23 Oct), never back to draft.
  update public.workflow_templates set status = 'archived' where owner_id = u;
  if not exists (select 1 from public.workflow_templates where owner_id = u and status = 'archived') then
    raise exception 'test 4a: the owner could not remove their preset from the list';
  end if;
  update public.workflow_templates set status = 'published', listed = false where owner_id = u;
  if not exists (select 1 from public.workflow_templates where owner_id = u and status = 'published' and not listed) then
    raise exception 'test 4b: the owner could not put it back or unlist it';
  end if;
  failed := false;
  begin
    update public.workflow_templates set status = 'draft' where owner_id = u;
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'test 4c: a published template went back to draft'; end if;

  -- 5. Not another user's, and never a system template.
  update public.workflow_templates set status = 'archived' where is_system;
  if exists (select 1 from public.workflow_templates where is_system and status = 'archived') then
    raise exception 'test 5a: a user archived a system template';
  end if;
  reset role;
  insert into public.workflow_templates (key, version, name, definition, status, is_system, owner_id)
    values ('custom_o_' || replace(other::text, '-', ''), 1, 'Theirs', def, 'published', false, other);
  set local role authenticated;
  update public.workflow_templates set status = 'archived' where owner_id = other;
  reset role;
  if exists (select 1 from public.workflow_templates where owner_id = other and status = 'archived') then
    raise exception 'test 5b: a user archived another user''s template';
  end if;
  set local role authenticated;

  reset role;
  raise notice 'user_workflow_templates: all tests passed';
end $$;

rollback;
