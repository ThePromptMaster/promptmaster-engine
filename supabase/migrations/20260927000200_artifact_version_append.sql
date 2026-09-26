-- ===========================================================================
-- artifact_versions.version_number and the artifact head are set by the database
-- ===========================================================================
--
-- The bug this fixes (outline approval, found in the Phase A verification pass):
--
-- appendVersion numbered a new version from the browser's cached
-- artifacts.version_count, then moved the head with an UPDATE guarded on
-- artifacts.revision. But revision is bumped by EVERY artifacts update
-- (touch_and_bump_revision), including writes that have nothing to do with
-- versions: the outline's 800 ms draft autosave, the stage summary written on
-- completion. So an outline edited, left for a second, then approved:
--
--   1. inserted v1 (fine),
--   2. failed the head move on the stale revision, leaving v1 written but the
--      artifact still at version_count 0 — "another tab moved this artifact on";
--   3. and every later attempt, even after a reload, computed version_count+1 = 1
--      again and hit av_artifact_version_uidx — "another tab saved a version
--      first … try again", forever. The project could not get past Outline.
--
-- The same shape as 20260926000000 (workflow_events.seq): one BEFORE INSERT
-- trigger assigns the number for every writer under a per-artifact advisory
-- lock, and one AFTER INSERT trigger moves the head in the same transaction.
-- A writer's supplied version_number and parent are ignored. The version and
-- the head can no longer disagree, and two tabs appending serialise into two
-- versions instead of one failing (this also closes known-limitation L-19).

create or replace function public.artifact_versions_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('artifact_versions.number:' || new.artifact_id::text, 0));

  -- max(version_number), not artifacts.version_count: an artifact left behind
  -- by the old bug has versions its counter never saw.
  select coalesce(max(v.version_number), 0) + 1
    into new.version_number
  from public.artifact_versions v
  where v.artifact_id = new.artifact_id;

  -- The parent is whatever the head is now, not what the writer last read.
  select a.current_version_id
    into new.parent_version_id
  from public.artifacts a
  where a.id = new.artifact_id;

  return new;
end;
$$;

revoke all on function public.artifact_versions_assign_number() from public;

drop trigger if exists artifact_versions_assign_number on public.artifact_versions;
create trigger artifact_versions_assign_number
  before insert on public.artifact_versions
  for each row execute function public.artifact_versions_assign_number();

create or replace function public.artifact_versions_move_head()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The insert has already passed RLS and av_artifact_fk (artifact_id, user_id),
  -- so this only ever touches the inserting user's own artifact. Forward-only:
  -- the head never moves back to an older number.
  update public.artifacts
     set current_version_id = new.id,
         version_count      = new.version_number
   where id = new.artifact_id
     and version_count < new.version_number;
  return null;
end;
$$;

revoke all on function public.artifact_versions_move_head() from public;

drop trigger if exists artifact_versions_move_head on public.artifact_versions;
create trigger artifact_versions_move_head
  after insert on public.artifact_versions
  for each row execute function public.artifact_versions_move_head();

-- Writers no longer need to supply a number. NOT NULL stays: it is checked
-- after BEFORE triggers run, so it still proves the trigger did its job.
alter table public.artifact_versions alter column version_number set default 0;

-- Repair artifacts the old bug already stranded: point the head at the newest
-- version that exists. Idempotent — a healthy artifact matches nothing.
update public.artifacts a
   set current_version_id = latest.id,
       version_count      = latest.version_number
  from (
    select distinct on (v.artifact_id) v.artifact_id, v.id, v.version_number
    from public.artifact_versions v
    order by v.artifact_id, v.version_number desc
  ) latest
 where latest.artifact_id = a.id
   and a.version_count < latest.version_number;
