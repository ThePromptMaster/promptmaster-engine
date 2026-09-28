-- Go mode: an autonomous run may complete a stage that has no artifact.
--
-- The rule stays: a system-actor completion must cite a version of that
-- stage. Outline approval holds no artifact, so there was nothing to cite,
-- every autonomous run left it "open", and the planner was then told about
-- a left-open stage on every later move. A stage with no artifacts row in
-- this project is the one honest exception, checked here, not trusted from
-- the payload.
--
-- Idempotent: safe to re-run.

create or replace function public.workflow_events_agent_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run record;
  auth_ok boolean;
begin
  -- Skipping, going back, finishing, reopening and upgrading are the user's
  -- decisions, whatever policy is running.
  if new.type in ('stage_skipped', 'stage_returned', 'project_finalized', 'project_reopened', 'template_upgraded')
     and (new.actor <> 'user' or new.agent_run_id is not null) then
    raise exception '% is a user decision; an agent run cannot record it', new.type using errcode = 'check_violation';
  end if;

  if new.agent_run_id is null then
    -- A system actor moving stage state without a run behind it is the shape
    -- FR-02 forbids. (The drain's section_written is not a stage move.)
    if new.actor = 'system' and new.type in (
         'stage_completed', 'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked', 'stage_entered') then
      raise exception 'a system-actor % must cite an authorized agent run', new.type using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.actor <> 'system' then
    raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
  end if;

  select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
  if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id then
    raise exception 'agent run % is not a run of this project', new.agent_run_id using errcode = 'check_violation';
  end if;
  if run.status <> 'running' then
    raise exception 'agent run % is %, not running', run.id, run.status using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.recommendations r
    where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
      and r.scope->>'kind' = 'agent_authorization'
  ) into auth_ok;

  -- What each policy may do on its own.
  -- An autonomous completion cites a version — or the stage has no artifact
  -- at all (Outline approval), in which case there is nothing it could cite
  -- and leaving it open forever was the only alternative (2026-10-04).
  if run.policy = 'autonomous' and auth_ok
     and (new.type in ('stage_advanced', 'stage_blocked')
          or (new.type = 'stage_marked_complete'
              and (new.payload ? 'evidence_version_id'
                   or not exists (select 1 from public.artifacts a
                                  where a.project_id = new.project_id and a.stage_id = new.stage_id)))) then
    return new;
  end if;
  if run.policy = 'checkpoint' and auth_ok and new.type = 'stage_blocked' then
    return new;
  end if;

  raise exception 'a % run may not record % on its own', run.policy, new.type using errcode = 'check_violation';
end;
$$;

drop trigger if exists workflow_events_agent_authorized on public.workflow_events;
create trigger workflow_events_agent_authorized
  before insert on public.workflow_events
  for each row execute function public.workflow_events_agent_authorized();
