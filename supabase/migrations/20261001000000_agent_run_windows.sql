-- Go mode: what a stopped run needs from the user, and runs that continue a
-- used-up window (B4, Sean 28 Sep items 3, 4 and 5).
--
-- `needs` is the structured "I need you to…" the panel renders with its one
-- button; it is data about a stop, not a status, so it changes freely while
-- the run is live and is frozen with the run.
--
-- `continues_run_id` chains windows: a run that ended `budget_exhausted` can
-- be continued by a new run of the same policy, under the same authorization,
-- in the same project. Each window is the user's click and, when the policy
-- needed an authorization, a further `decisions` row cites it. The step
-- budget stays a cap per window; the project-level loop is the chain.
--
-- Idempotent: safe to re-run.

alter table public.agent_runs
  add column if not exists needs jsonb,
  add column if not exists continues_run_id uuid references public.agent_runs(id) on delete restrict;

create index if not exists agent_runs_continues_idx on public.agent_runs (continues_run_id)
  where continues_run_id is not null;

create or replace function public.agent_runs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  rec    record;
  parent record;
begin
  if tg_op = 'INSERT' then
    if new.authorization_id is not null then
      select r.status, r.user_id, r.scope into rec from public.recommendations r where r.id = new.authorization_id;
      if not found or rec.user_id is distinct from new.user_id or rec.status <> 'accepted'
         or rec.scope->>'kind' is distinct from 'agent_authorization'
         or rec.scope->>'policy' is distinct from new.policy then
        raise exception 'agent run authorization must be an accepted agent_authorization for policy % by the same user', new.policy
          using errcode = 'check_violation';
      end if;
    end if;
    if new.continues_run_id is not null then
      select a.* into parent from public.agent_runs a where a.id = new.continues_run_id;
      if not found or parent.user_id is distinct from new.user_id or parent.project_id is distinct from new.project_id then
        raise exception 'a run can only continue a run of the same project' using errcode = 'check_violation';
      end if;
      if parent.status <> 'budget_exhausted' then
        raise exception 'a run can only continue one whose window was used up (it is %)', parent.status using errcode = 'check_violation';
      end if;
      if parent.policy is distinct from new.policy or parent.authorization_id is distinct from new.authorization_id then
        raise exception 'a continued run keeps the same policy and authorization' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- What was authorized cannot be changed after the fact.
  if new.policy is distinct from old.policy or new.authorization_id is distinct from old.authorization_id
     or new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id
     or new.continues_run_id is distinct from old.continues_run_id then
    raise exception 'an agent run''s policy, authorization, project and lineage are fixed' using errcode = 'check_violation';
  end if;
  -- Terminal statuses are final.
  if old.status in ('completed', 'budget_exhausted', 'stopped', 'failed') and new.status is distinct from old.status then
    raise exception 'agent run % has ended (%); start a new run', old.id, old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_runs_guard on public.agent_runs;
create trigger agent_runs_guard
  before insert or update on public.agent_runs
  for each row execute function public.agent_runs_guard();

comment on column public.agent_runs.needs is
  'What the run needs from the user before it can continue: {kind, ...} rendered as the "I need you to…" card (B4).';
comment on column public.agent_runs.continues_run_id is
  'The budget_exhausted run this one continues: same project, policy and authorization. Windows chain; each is the user''s click (B4).';
