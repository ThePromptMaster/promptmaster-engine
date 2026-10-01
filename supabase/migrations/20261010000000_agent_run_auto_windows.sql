-- Go mode: windows a run starts on its own are counted by the database
-- (1 Oct, item 20; plan 4.6).
--
-- An Autonomous authorization may allow up to three further windows without
-- asking (`scope.auto_continue_windows`). Until now only the browser counted
-- them, so a bug in the loop could have kept a run going past what the user
-- agreed to. A window the loop starts by itself is now marked
-- `auto_continued`, and the guard refuses one once the chain already holds as
-- many consecutive such windows as the authorization allows. A window the
-- user clicks is not marked and starts the count again.
--
-- What this does not do: tell an honest client from one that leaves the mark
-- off. The row is written by the user's own session; the guard holds the loop
-- to its terms, it does not defend the user against themselves.
--
-- Idempotent: safe to re-run.

alter table public.agent_runs
  add column if not exists auto_continued boolean not null default false;

create or replace function public.agent_runs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  rec     record;
  parent  record;
  allowed integer;
  taken   integer := 0;
  cursor_id uuid;
  link    record;
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
    if new.auto_continued then
      if new.continues_run_id is null or new.policy <> 'autonomous' or new.authorization_id is null then
        raise exception 'only an authorized autonomous run can continue on its own' using errcode = 'check_violation';
      end if;
      -- What the user agreed to, never more than three. Anything unreadable is none.
      allowed := case when rec.scope->>'auto_continue_windows' ~ '^[0-9]{1,3}$'
                      then least((rec.scope->>'auto_continue_windows')::integer, 3) else 0 end;
      -- Consecutive windows the loop already started by itself, back to the last one the user clicked.
      cursor_id := new.continues_run_id;
      while cursor_id is not null loop
        select a.auto_continued, a.continues_run_id into link from public.agent_runs a where a.id = cursor_id;
        exit when not found or not link.auto_continued;
        taken := taken + 1;
        cursor_id := link.continues_run_id;
      end loop;
      if taken >= allowed then
        raise exception 'this run was authorized to continue on its own % time(s) and already has', allowed
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- What was authorized cannot be changed after the fact.
  if new.policy is distinct from old.policy or new.authorization_id is distinct from old.authorization_id
     or new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id
     or new.continues_run_id is distinct from old.continues_run_id
     or new.auto_continued is distinct from old.auto_continued then
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

comment on column public.agent_runs.auto_continued is
  'True when the loop started this window itself under auto_continue_windows; the guard counts these against the authorization (max 3 in a row).';
