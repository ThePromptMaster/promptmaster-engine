-- Project sources are listed in the order they were saved, including the
-- several one search saves in a single insert (22 Oct): they are cited as
-- [S1], [S2], … in that order.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/project_sources_order.sql
--
-- Self-contained; everything is rolled back. CI runs every file here.

begin;

do $$
declare
  u      uuid := gen_random_uuid();
  proj   uuid := gen_random_uuid();
  failed boolean;
  urls   text[];
begin
  insert into auth.users (id, email) values (u, 'ps-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'sources order test');

  -- 1. One search's sources, in one insert: one timestamp, listed as written.
  insert into public.project_sources (project_id, user_id, url, query)
    select proj, u, 'https://example.org/' || n, 'search one'
      from unnest(array[9, 3, 7, 1, 5]) with ordinality as t(n, i) order by i;
  insert into public.project_sources (project_id, user_id, url, query)
    values (proj, u, 'https://example.org/z', 'search two'), (proj, u, 'https://example.org/a', 'search two');

  select array_agg(url order by seq) into urls from public.project_sources where project_id = proj;
  if urls <> array['https://example.org/9', 'https://example.org/3', 'https://example.org/7', 'https://example.org/1',
                   'https://example.org/5', 'https://example.org/z', 'https://example.org/a'] then
    raise exception 'sources are not listed in the order they were saved: %', urls;
  end if;

  -- 2. The order cannot be rewritten.
  failed := false;
  begin
    update public.project_sources set seq = 1 where project_id = proj and url = 'https://example.org/a';
  exception when others then failed := true;
  end;
  if not failed then raise exception 'a source''s place in the order was changed'; end if;

  -- 3. Retiring still works.
  update public.project_sources set retired_at = now() where project_id = proj and url = 'https://example.org/z';
end;
$$;

rollback;
