-- Go mode: "Keep going" (3 Oct call — work that "is going to go on forever").
--
-- An Autonomous authorization could allow at most three further windows
-- without asking. Open-ended work outgrows that, so the ceiling is now twenty:
-- still a number the user picks and the authorization records, never
-- unbounded on cost, and each window still a recorded run. Rounds of a
-- looping workflow are started by the user regardless (a return is theirs).
--
-- Only the ceiling changes; the function is otherwise 20261010000000's.
-- Idempotent: safe to re-run.

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
      -- What the user agreed to, never more than twenty. Anything unreadable is none.
      allowed := case when rec.scope->>'auto_continue_windows' ~ '^[0-9]{1,3}$'
                      then least((rec.scope->>'auto_continue_windows')::integer, 20) else 0 end;
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

  if new.policy is distinct from old.policy or new.authorization_id is distinct from old.authorization_id
     or new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id
     or new.continues_run_id is distinct from old.continues_run_id
     or new.auto_continued is distinct from old.auto_continued then
    raise exception 'an agent run''s policy, authorization, project and lineage are fixed' using errcode = 'check_violation';
  end if;
  if old.status in ('completed', 'budget_exhausted', 'stopped', 'failed') and new.status is distinct from old.status then
    raise exception 'agent run % has ended (%); start a new run', old.id, old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on column public.agent_runs.auto_continued is
  'True when the loop started this window itself under auto_continue_windows; the guard counts these against the authorization (max 20 in a row).';
