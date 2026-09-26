-- ===========================================================================
-- workflow_events.seq is allocated by the database, not by the writer
-- ===========================================================================
--
-- The bug this fixes (PM-03, "Finish does nothing"):
--
-- The browser allocated seq as `events.length + 1` from its last read of the
-- log, while write_long_form_section (20260907000100) allocates max(seq)+1
-- server-side as drafting proceeds. Any section written after the page last
-- read the log made the browser's next seq a duplicate, the insert failed on
-- we_project_seq_uidx, and the transition was silently lost. Finish on a
-- drafted book was the common case.
--
-- The fix is one BEFORE INSERT trigger that assigns seq for every writer,
-- under a per-project transaction-scoped advisory lock, so two concurrent
-- writers for one project serialise and each takes max+1 after the other has
-- committed. A writer's supplied seq is ignored. That covers the browser, the
-- long-form SQL function and any future writer without redefining any of them.
--
-- Two different base values already exist in old logs (browser rows start at
-- 1, server rows at max(-1)+1 = 0 when first). Only ordering matters to the
-- projection, so they are left as they are.

create or replace function public.workflow_events_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- hashtextextended gives a 64-bit key; the prefix keeps it from colliding
  -- with any other advisory lock taken on a project id.
  perform pg_advisory_xact_lock(hashtextextended('workflow_events.seq:' || new.project_id::text, 0));

  select coalesce(max(e.seq), 0) + 1
    into new.seq
  from public.workflow_events e
  where e.project_id = new.project_id;

  return new;
end;
$$;

revoke all on function public.workflow_events_assign_seq() from public;

drop trigger if exists workflow_events_assign_seq on public.workflow_events;
create trigger workflow_events_assign_seq
  before insert on public.workflow_events
  for each row execute function public.workflow_events_assign_seq();

-- Writers no longer need to supply seq. The column stays NOT NULL: the
-- constraint is checked after BEFORE triggers run, so it still guarantees the
-- trigger did its job.
alter table public.workflow_events alter column seq set default 0;
