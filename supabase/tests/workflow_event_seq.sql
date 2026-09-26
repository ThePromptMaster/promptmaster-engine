-- workflow_events.seq is assigned by the database (PM-03, "Finish does nothing").
--
-- Before 20260926000000 the browser allocated seq from its last read of the
-- log while write_long_form_section allocated max+1 server-side, so a section
-- written after the page loaded made the browser's next transition collide on
-- we_project_seq_uidx and vanish. This asserts the trigger makes every writer's
-- seq irrelevant. CI runs every file in supabase/tests/.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_event_seq.sql
--
-- Self-contained; everything is rolled back.

begin;

do $$
declare
  u    uuid := gen_random_uuid();
  proj uuid := gen_random_uuid();
  seqs bigint[];
begin
  insert into auth.users (id, email) values (u, 'seq-' || u || '@promptmaster.test');
  insert into public.projects (id, user_id, title) values (proj, u, 'seq test');

  -- The browser's stale write: it believes seq 1 is next.
  insert into public.workflow_events (user_id, project_id, seq, type, stage_id)
    values (u, proj, 1, 'project_created', 'objective');
  -- The drain writes a section the browser has not seen (claims seq 2).
  insert into public.workflow_events (user_id, project_id, seq, type, stage_id, actor)
    values (u, proj, 2, 'section_written', 'drafting', 'system');
  -- The browser, still believing 2 is next, presses Finish. This is the write
  -- that used to fail.
  insert into public.workflow_events (user_id, project_id, seq, type, stage_id)
    values (u, proj, 2, 'stage_completed', 'drafting');
  -- A writer that supplies no seq at all.
  insert into public.workflow_events (user_id, project_id, type, stage_id)
    values (u, proj, 'stage_entered', 'final_review');

  select array_agg(seq order by seq) into seqs from public.workflow_events where project_id = proj;
  if seqs is distinct from array[1, 2, 3, 4]::bigint[] then
    raise exception 'expected seq 1..4 in write order, got %', seqs;
  end if;

  -- Order of the log is the order of the writes.
  if (select type from public.workflow_events where project_id = proj and seq = 3) <> 'stage_completed' then
    raise exception 'the Finish write did not land at seq 3';
  end if;

  raise notice 'workflow_event_seq: all assertions passed';
end;
$$;

rollback;
