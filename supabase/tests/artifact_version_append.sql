-- artifact_versions.version_number and the head are set by the database.
--
-- Before 20260927000200 the browser numbered a version from its cached
-- version_count and moved the head with a revision-guarded UPDATE. Any other
-- artifact write in between (the outline draft autosave) made the head move
-- fail, stranding the version, and every retry then collided on the same
-- number. This asserts the stranded state heals and cannot recur.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/artifact_version_append.sql
--
-- Self-contained; everything is rolled back.

begin;

do $$
declare
  u    uuid := gen_random_uuid();
  proj uuid := gen_random_uuid();
  art  uuid := gen_random_uuid();
  v1   uuid;
  v2   uuid;
  v3   uuid;
  nums int[];
  a    record;
begin
  insert into auth.users (id, email) values (u, 'avn-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'append test');
  insert into public.artifacts (id, user_id, project_id, kind, name, stage_id)
    values (art, u, proj, 'outline', 'Outline', 'outline');

  -- A writer that supplies a stale number (the old browser path) is ignored.
  insert into public.artifact_versions (user_id, project_id, artifact_id, version_number, content)
    values (u, proj, art, 1, 'first') returning id into v1;

  -- Something else touches the artifact (the draft autosave); revision moves.
  update public.artifacts set outline_draft = '{"schema":1,"items":[]}'::jsonb where id = art;

  -- The approval's append still lands and becomes the head, despite claiming 1.
  insert into public.artifact_versions (user_id, project_id, artifact_id, version_number, content)
    values (u, proj, art, 1, 'second') returning id into v2;

  select * into a from public.artifacts where id = art;
  if a.current_version_id <> v2 or a.version_count <> 2 then
    raise exception 'head should be v2 at count 2, got % at %', a.current_version_id, a.version_count;
  end if;
  if (select parent_version_id from public.artifact_versions where id = v2) <> v1 then
    raise exception 'v2 should descend from v1';
  end if;

  -- The stranded state the old bug left: versions the counter never saw.
  -- Simulate it, then check the next append heals rather than colliding.
  alter table public.artifacts disable trigger artifacts_touch;
  update public.artifacts set version_count = 0, current_version_id = null where id = art;
  alter table public.artifacts enable trigger artifacts_touch;

  insert into public.artifact_versions (user_id, project_id, artifact_id, content)
    values (u, proj, art, 'third') returning id into v3;

  select array_agg(version_number order by version_number) into nums
    from public.artifact_versions where artifact_id = art;
  if nums is distinct from array[1, 2, 3] then
    raise exception 'expected versions 1..3, got %', nums;
  end if;
  select * into a from public.artifacts where id = art;
  if a.current_version_id <> v3 or a.version_count <> 3 then
    raise exception 'a stranded artifact did not heal: head % at %', a.current_version_id, a.version_count;
  end if;

  raise notice 'artifact_version_append: all assertions passed';
end;
$$;

rollback;
