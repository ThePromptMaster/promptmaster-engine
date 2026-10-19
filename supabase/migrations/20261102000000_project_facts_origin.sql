-- S2b (Sean, 18 Oct, email 10): "When setup expands my request, how are my
-- instructions and accepted changes distinguished from model-proposed
-- assumptions?"
--
-- Until now, not at all: every fact the front door drafted was saved as the
-- user's, the same as one they typed. `origin` says where the statement itself
-- came from, separately from who accepted it (`accepted_by`):
--   user_stated    the user said it (typed, edited, or their own words in chat)
--   model_assumed  PromptMaster inferred it while drafting the brief, and the
--                  user accepted it without having said it
--   policy         Go accepted it under the routine-decision policy
-- A policy origin and a policy acceptance always go together.
--
-- Facts are append-only, so the backfill of policy rows runs with the
-- append-only trigger disabled, and the trigger is then re-created to compare
-- `origin` too: like every other column, it is never edited.
--
-- Idempotent: safe to re-run.

alter table public.project_facts
  add column if not exists origin text not null default 'user_stated';

alter table public.project_facts drop constraint if exists project_facts_origin_chk;
alter table public.project_facts
  add constraint project_facts_origin_chk check (origin in ('user_stated', 'model_assumed', 'policy'));

-- A policy-accepted fact is stated by Go's policy, whatever the client sends.
create or replace function public.project_facts_origin_default()
returns trigger
language plpgsql
as $$
begin
  if new.accepted_by = 'policy' then
    new.origin := 'policy';
  elsif new.origin = 'policy' then
    raise exception 'only a fact accepted under the routine-decision policy has a policy origin' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_facts_origin_default on public.project_facts;
create trigger project_facts_origin_default
  before insert on public.project_facts
  for each row execute function public.project_facts_origin_default();

alter table public.project_facts disable trigger project_facts_append_only;
update public.project_facts set origin = 'policy' where accepted_by = 'policy' and origin <> 'policy';
alter table public.project_facts enable trigger project_facts_append_only;

alter table public.project_facts drop constraint if exists project_facts_origin_policy_chk;
alter table public.project_facts
  add constraint project_facts_origin_policy_chk check ((origin = 'policy') = (accepted_by = 'policy'));

-- A fact is never edited. The one change allowed is retiring it, once.
create or replace function public.project_facts_append_only()
returns trigger
language plpgsql
as $$
begin
  if old.retired_at is not null then
    raise exception 'fact % is already retired', old.id using errcode = 'check_violation';
  end if;
  if new.retired_at is null
     or (new.id, new.project_id, new.user_id, new.statement, new.subject, new.kind, new.source_kind,
         new.source_ref, new.accepted_by, new.agent_run_id, new.supersedes, new.created_at, new.origin)
        is distinct from
        (old.id, old.project_id, old.user_id, old.statement, old.subject, old.kind, old.source_kind,
         old.source_ref, old.accepted_by, old.agent_run_id, old.supersedes, old.created_at, old.origin) then
    raise exception 'a fact is never edited; record a new one that supersedes it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
