-- FR-20: make "recoverable by default" a bounded promise instead of an open one.
--
-- `softDeleteProject` sets `deleted_at` and its docstring says "a scheduled job
-- removes the row later". No such job existed. Every project any user has ever
-- deleted is still in this table, with its artifacts, every version of every
-- artifact, and every evaluation — indefinitely, and invisibly, because
-- `listProjects` filters them out. That is the worst of both worlds: the user
-- believes the data is gone, and it is not.
--
-- Two things close it, and both are needed.
--
-- 1. **This purge.** Thirty days after a soft delete the row goes, and the
--    composite `on delete cascade` FKs take artifacts, versions and evaluations
--    with it. Thirty rather than seven because the mistake this protects
--    against — deleting the wrong project — is often noticed weeks later, when
--    someone goes looking for it; and rather than ninety because a beta that
--    tells users not to enter sensitive information should not hold what they
--    entered anyway for a quarter.
--
-- 2. **A trash view** (`/projects`), where a user can restore inside the window
--    or destroy immediately. The immediate path matters more than it looks: the
--    beta notice warns against entering sensitive information, and the honest
--    answer for someone who did it anyway is a delete that means it, not a flag
--    that expires in a month.
--
-- Scheduling is conditional on pg_cron being installed, and the function stands
-- on its own if it is not. A migration that hard-depends on an extension the
-- project may not have is a migration that fails to apply against an empty
-- database — which this repository has been bitten by twice already. When cron
-- is absent the function is still callable by an operator or a deploy hook, and
-- `select public.purge_deleted_projects();` is the whole runbook.

create or replace function public.purge_deleted_projects(
  retention interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  -- Children are removed by the composite (project_id, user_id) cascades
  -- declared in the core migration, so this deliberately deletes only the
  -- parent. Enumerating the child tables here would create a second, silently
  -- divergent definition of what a project consists of.
  delete from public.projects
  where deleted_at is not null
    and deleted_at < now() - retention;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_deleted_projects(interval) is
  'FR-20: permanently removes projects soft-deleted longer ago than the retention window (default 30 days). Children go via cascade. Returns the number of projects removed.';

-- Not callable by users. A soft delete is theirs to undo; the purge is an
-- operational job, and a security-definer function that any authenticated
-- session could invoke with `interval ''0''` would be a way to bypass the
-- retention window entirely.
revoke all on function public.purge_deleted_projects(interval) from public;
revoke all on function public.purge_deleted_projects(interval) from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule first: cron.schedule with an existing name errors rather than
    -- replacing, which would make this migration non-idempotent.
    perform cron.unschedule('purge-deleted-projects')
    where exists (select 1 from cron.job where jobname = 'purge-deleted-projects');

    perform cron.schedule(
      'purge-deleted-projects',
      '17 3 * * *',
      $cron$select public.purge_deleted_projects();$cron$
    );
  else
    raise notice
      'pg_cron is not installed; purge_deleted_projects() created but not scheduled. Run it from a deploy hook or enable pg_cron and re-run this migration.';
  end if;
end;
$$;
