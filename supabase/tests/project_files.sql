-- Project data files: a file belongs to a project of the same user, its name
-- is unique within the project, and only its owner can see or remove it.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/project_files.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u      uuid := gen_random_uuid();
  u2     uuid := gen_random_uuid();
  proj   uuid := gen_random_uuid();
  failed boolean;
  seen   integer;
begin
  insert into auth.users (id, email) values (u, 'pf-' || u || '@promptmaster.test');
  insert into auth.users (id, email) values (u2, 'pf2-' || u2 || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'files test');

  insert into public.project_files (project_id, user_id, name, path, bytes)
    values (proj, u, 'accounts.csv', u || '/' || proj || '/1-accounts.csv', 120);

  -- 1. The same name twice in one project: refused.
  failed := false;
  begin
    insert into public.project_files (project_id, user_id, name, path, bytes)
      values (proj, u, 'accounts.csv', u || '/' || proj || '/2-accounts.csv', 120);
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'a second file with the same name was accepted'; end if;

  -- 2. Another user's file parented into this project: refused by the composite key.
  failed := false;
  begin
    insert into public.project_files (project_id, user_id, name, path, bytes)
      values (proj, u2, 'theirs.csv', u2 || '/' || proj || '/1-theirs.csv', 10);
  exception when foreign_key_violation then failed := true;
  end;
  if not failed then raise exception 'a file was parented into another user''s project'; end if;

  -- 3. Over the size limit: refused.
  failed := false;
  begin
    insert into public.project_files (project_id, user_id, name, path, bytes)
      values (proj, u, 'huge.csv', u || '/' || proj || '/3-huge.csv', 5000001);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'a file over the size limit was accepted'; end if;

  -- 4. Row level security: the other user sees nothing and removes nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into seen from public.project_files where project_id = proj;
  if seen <> 0 then raise exception 'another user can see % project file(s)', seen; end if;
  delete from public.project_files where project_id = proj;
  reset role;
  select count(*) into seen from public.project_files where project_id = proj;
  if seen <> 1 then raise exception 'another user removed a project file'; end if;

  -- 5. Deleting the project takes its files with it.
  delete from public.projects where id = proj;
  select count(*) into seen from public.project_files where project_id = proj;
  if seen <> 0 then raise exception 'files outlived their project'; end if;
end $$;

rollback;
