-- 25 Oct (Sean, quantum gravity research): "PromptMaster proposed creating a
-- new stage called 'Two-interval Rényi-2 calculation (P1)' … but it didn't
-- actually create and activate that stage." A project may now add a stage
-- while it runs: `stage_added`, whose payload carries the stage's design. The
-- pinned template version is untouched; the browser puts added stages in
-- place (`effectiveTemplate`) and the projection enters the new one.
--
-- Who may record it: the user, or an authorized autonomous run with routine
-- decisions handed to Go, saying why, at most three per run. The rest of the
-- function is unchanged from 20261030000000.
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
  'brief_changed', 'brief_change_dismissed', 'objective_assessed',
  'stage_version_saved', 'web_access_changed', 'stage_added'));

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
  -- 25 Oct (Sean, quantum gravity): a stage added while the project runs.
  -- The event carries the stage it adds (payload.stage, with stage_id as its
  -- id). The user may add one; a run may only when it is an authorized
  -- autonomous run with routine decisions handed to Go, says why, and has
  -- added fewer than three. The pinned template is never changed.
  if new.type = 'stage_added' then
    if coalesce(new.payload->'stage'->>'id', '') <> new.stage_id
       or coalesce(btrim(new.payload->'stage'->>'label'), '') = ''
       or coalesce(new.payload->'stage'->>'after', '') = '' then
      raise exception 'stage_added carries the stage it adds: its id (the event''s stage_id), label and the stage it follows' using errcode = 'check_violation';
    end if;
    if new.agent_run_id is null then
      if new.actor <> 'user' then
        raise exception 'a stage is added by the user or by an authorized run' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.actor <> 'system' then
      raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.reason), '') = '' then
      raise exception 'a stage Go adds records why' using errcode = 'check_violation';
    end if;
    select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
    if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id
       or run.status <> 'running' or run.policy <> 'autonomous' then
      raise exception 'only a running autonomous run of this project may add a stage' using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from public.recommendations r
      where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
        and r.scope->>'kind' = 'agent_authorization'
    ) into auth_ok;
    if not coalesce(auth_ok, false) then
      raise exception 'an autonomous run without an accepted authorization may not add a stage' using errcode = 'check_violation';
    end if;
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; adding a stage is the user''s' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.workflow_events w
        where w.agent_run_id = new.agent_run_id and w.type = 'stage_added') >= 3 then
      raise exception 'a run adds at most three stages' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- The next round of an ongoing workflow (7 Oct): started by an authorized
  -- autonomous run only when the project's routine decisions are Go's to
  -- handle, and only along the loop the pinned template defines — from the
  -- stage that closes a round back to where the round starts. Any other
  -- return is still the user's (below).
  if new.type = 'stage_returned' and new.agent_run_id is not null
     and coalesce(new.payload->>'next_round', '') = 'true' then
    if new.actor <> 'system' then
      raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
    end if;
    select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
    if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id
       or run.status <> 'running' or run.policy <> 'autonomous' then
      raise exception 'only a running autonomous run of this project may start the next round' using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from public.recommendations r
      where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
        and r.scope->>'kind' = 'agent_authorization'
    ) into auth_ok;
    if not coalesce(auth_ok, false) then
      raise exception 'an autonomous run without an accepted authorization may not start a round' using errcode = 'check_violation';
    end if;
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; starting the next round is the user''s' using errcode = 'check_violation';
    end if;
    select exists (
      select 1
      from public.projects p
      join public.workflow_templates t on t.id = p.workflow_template_id,
      jsonb_array_elements(t.definition->'stages') st
      where p.id = new.project_id
        and st->>'id' = new.stage_id
        and st->'transitions'->>'loop_to' = new.to_stage_id
    ) into delegable;
    if not coalesce(delegable, false) then
      raise exception 'the workflow does not loop from % to %', new.stage_id, new.to_stage_id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Q2 (Sean, 9 Oct: "if Analysis identifies that further investigation is
  -- needed, Go should return to Experiment … perform the relevant work it
  -- can, save the results, and rerun the affected analysis and checks"):
  -- an authorized autonomous run, with routine decisions Go's to handle, may
  -- go back to an earlier stage — only to one the pinned template lets this
  -- stage return to, and only with the reason recorded. Every other return
  -- is still the user's (below).
  if new.type = 'stage_returned' and new.agent_run_id is not null
     and coalesce(new.payload->>'agent_return', '') = 'true' then
    if new.actor <> 'system' then
      raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.payload->>'return_reason'), '') = '' then
      raise exception 'a return made by Go records why' using errcode = 'check_violation';
    end if;
    select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
    if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id
       or run.status <> 'running' or run.policy <> 'autonomous' then
      raise exception 'only a running autonomous run of this project may go back a stage' using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from public.recommendations r
      where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
        and r.scope->>'kind' = 'agent_authorization'
    ) into auth_ok;
    if not coalesce(auth_ok, false) then
      raise exception 'an autonomous run without an accepted authorization may not go back a stage' using errcode = 'check_violation';
    end if;
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; going back is the user''s' using errcode = 'check_violation';
    end if;
    select exists (
      select 1
      from public.projects p
      join public.workflow_templates t on t.id = p.workflow_template_id,
      jsonb_array_elements(t.definition->'stages') st
      where p.id = new.project_id
        and st->>'id' = new.stage_id
        and (st->'transitions'->'allow_return_to') ? new.to_stage_id
    ) into delegable;
    if not coalesce(delegable, false) then
      raise exception 'the workflow does not let % return to %', new.stage_id, new.to_stage_id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Q4 (Sean, 9 Oct: "Routine changes within the objective and delegated
  -- authority could proceed automatically"): an authorized autonomous run,
  -- with routine decisions Go's to handle, may skip a stage the pinned
  -- template marks optional, with its reason recorded. A required stage is
  -- still skipped only by the user (below).
  if new.type = 'stage_skipped' and new.agent_run_id is not null then
    if new.actor <> 'system' then
      raise exception 'an event citing an agent run is the run acting; actor must be system' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.reason), '') = '' then
      raise exception 'a stage Go skips records why' using errcode = 'check_violation';
    end if;
    select a.* into run from public.agent_runs a where a.id = new.agent_run_id;
    if not found or run.user_id is distinct from new.user_id or run.project_id is distinct from new.project_id
       or run.status <> 'running' or run.policy <> 'autonomous' then
      raise exception 'only a running autonomous run of this project may skip a stage' using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from public.recommendations r
      where r.id = run.authorization_id and r.user_id = run.user_id and r.status = 'accepted'
        and r.scope->>'kind' = 'agent_authorization'
    ) into auth_ok;
    if not coalesce(auth_ok, false) then
      raise exception 'an autonomous run without an accepted authorization may not skip a stage' using errcode = 'check_violation';
    end if;
    select p.routine_decisions into policy from public.projects p where p.id = new.project_id;
    if policy is distinct from 'handle' then
      raise exception 'routine decisions are set to ask on this project; skipping is the user''s' using errcode = 'check_violation';
    end if;
    select exists (
      select 1
      from public.projects p
      join public.workflow_templates t on t.id = p.workflow_template_id,
      jsonb_array_elements(t.definition->'stages') st
      where p.id = new.project_id
        and st->>'id' = new.stage_id
        and coalesce((st->>'required')::boolean, true) = false
    ) into delegable;
    if not coalesce(delegable, false) then
      raise exception '% is a required stage; only the user may skip it', new.stage_id using errcode = 'check_violation';
    end if;
    return new;
  end if;

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
  if new.type in ('revision_refused', 'objective_assessed', 'stage_version_saved') then
    return new;
  end if;

  raise exception 'a % run may not record % on its own', run.policy, new.type using errcode = 'check_violation';
end;
$$;

drop trigger if exists workflow_events_agent_authorized on public.workflow_events;
create trigger workflow_events_agent_authorized
  before insert on public.workflow_events
  for each row execute function public.workflow_events_agent_authorized();
