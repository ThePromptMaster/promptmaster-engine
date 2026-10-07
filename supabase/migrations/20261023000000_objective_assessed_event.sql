-- O2 (Sean, 6 Oct, email 13): "Go marked 'Objective complete' … Its
-- explanation acknowledges that 'the research objective itself is not
-- solved', then treats the finished workflow cycle as sufficient."
--
-- objective_assessed records the judgment Go must pass before it may say the
-- objective is met: outcome (met | not_met | partly), the quote it rests on,
-- the blockers (what is missing, and what kind), the work the run record shows
-- performed, and what is only proposed. It moves no stage. Go records it under
-- its run (actor system); the user may record one by asking for the check.
--
-- The type list repeats every value since 20261003, so it is right whichever
-- of those migrations a database already has.
--
-- Idempotent: safe to re-run.

alter table public.workflow_events drop constraint if exists we_type_chk;
alter table public.workflow_events add constraint we_type_chk check (type in (
  'project_created', 'stage_entered', 'stage_completed', 'stage_skipped',
  'stage_returned', 'outline_approved', 'outline_version_created',
  'section_written', 'section_regenerated', 'job_enqueued', 'job_failed',
  'generation_paused', 'generation_resumed', 'imported_from_session',
  'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked',
  'project_finalized', 'project_reopened', 'template_upgraded', 'stage_reopened',
  'revision_refused', 'routine_policy_changed', 'criterion_committed',
  'brief_changed', 'brief_change_dismissed', 'objective_assessed'));

alter table public.workflow_events drop constraint if exists we_objective_assessed_chk;
alter table public.workflow_events add constraint we_objective_assessed_chk check (
  type <> 'objective_assessed' or payload->>'outcome' in ('met', 'not_met', 'partly')
);

create or replace function public.workflow_events_agent_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run record;
  auth_ok boolean;
  policy text;
  delegable boolean;
begin
  -- Skipping, going back, finishing, reopening and upgrading are the user's
  -- decisions, whatever policy is running.
  if new.type in ('stage_skipped', 'stage_returned', 'project_finalized', 'project_reopened', 'template_upgraded')
     and (new.actor <> 'user' or new.agent_run_id is not null) then
    raise exception '% is a user decision; an agent run cannot record it', new.type using errcode = 'check_violation';
  end if;

  -- A committed criterion is the routine-decision policy acting, never a click.
  if new.type = 'criterion_committed' and new.agent_run_id is null then
    raise exception 'criterion_committed is recorded by a run acting under the routine-decision policy' using errcode = 'check_violation';
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

  -- The routine-decision policy, read now rather than when the run started.
  if new.type = 'criterion_committed' then
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    select exists (
      select 1
      from public.projects p
      join public.workflow_templates t on t.id = p.workflow_template_id,
      jsonb_array_elements(t.definition->'stages') st,
      jsonb_array_elements(st->'exit_criteria') c
      where p.id = new.project_id
        and st->>'id' = new.stage_id
        and c->>'id' = new.payload->>'criterion_id'
        and c->>'check' = 'manual'
        and c->>'authority' = 'delegable'
    ) into delegable;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; % is the user''s', new.payload->>'criterion_id' using errcode = 'check_violation';
    end if;
    if not coalesce(delegable, false) then
      raise exception '% is reserved to the user', coalesce(new.payload->>'criterion_id', 'that approval') using errcode = 'check_violation';
    end if;
    if run.policy = 'guided' or auth_ok then
      return new;
    end if;
    raise exception 'a % run without an accepted authorization may not commit a decision', run.policy using errcode = 'check_violation';
  end if;

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
  -- A record of a refused revision moves nothing; nor does a judgment of
  -- whether the objective is met.
  if new.type in ('revision_refused', 'objective_assessed') then
    return new;
  end if;

  raise exception 'a % run may not record % on its own', run.policy, new.type using errcode = 'check_violation';
end;
$$;

drop trigger if exists workflow_events_agent_authorized on public.workflow_events;
create trigger workflow_events_agent_authorized
  before insert on public.workflow_events
  for each row execute function public.workflow_events_agent_authorized();
