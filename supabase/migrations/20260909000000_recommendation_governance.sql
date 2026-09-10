-- Phase 2 M4.2: enforce the proposal boundary on the table that is actually read.
--
-- FR-02 says model output "may propose but does not silently own state
-- transitions". M1 expressed that as a `proposal_id` column on
-- `project_stage_events`, with a DDL comment claiming "a model reaches stage
-- state only by way of proposal_id pointing at an accepted recommendation".
--
-- That claim was not true of the running system. `project_stage_events` has
-- never had a reader or a writer. The live stage history is
-- `workflow_events` — `projectState()` replays it and `appendWorkflowEvent`
-- writes it — and it had no `proposal_id` column at all, so there was nowhere
-- for a proposal-driven transition to record its provenance and nothing
-- checking that a cited proposal was real, owned, or accepted.
--
-- This migration:
--   1. adds `proposal_id` to `workflow_events`, so the live log can carry the
--      evidence the invariant is about;
--   2. installs ONE trigger function on BOTH tables, so the rule is stated
--      once and cannot hold on one history and not the other;
--   3. stops an accepted recommendation being rewritten after an event cites
--      it — RLS grants UPDATE on `recommendations`, and without this a client
--      could swap the instruction under a decision already recorded.
--
-- Deliberately NOT done here: writing `project_stage_events`. A second live
-- stage history running beside `workflow_events` is worse than a dead one —
-- two logs that can disagree are not an audit trail. The consolidation (drop
-- it, or migrate `workflow_events` into it) is a separate change with a
-- backfill; until then the trigger keeps the dormant table honest so that
-- adopting it later cannot quietly adopt a weaker rule.
--
-- Widens no existing CHECK constraint.

-- ---------------------------------------------------------------------------
-- 1. workflow_events carries the proposal it acted on
-- ---------------------------------------------------------------------------
--
-- `on delete restrict`, not `set null`. If a cited recommendation could be
-- deleted out from under an event, the event would afterwards read as an
-- ordinary unprompted user transition — the exact fact FR-02 asks the log to
-- preserve would be the one thing the deletion erased. Restrict makes the
-- evidence undeletable rather than silently falsifiable. (RLS grants no
-- DELETE on recommendations today; this holds the line for the service role
-- and for any future policy.)

alter table public.workflow_events
  add column if not exists proposal_id uuid
    references public.recommendations(id) on delete restrict;

create index if not exists we_proposal_idx
  on public.workflow_events (proposal_id) where proposal_id is not null;

comment on column public.workflow_events.proposal_id is
  'The accepted recommendation this transition acted on, if any. Validated by '
  'stage_event_proposal_accepted(): the proposal must exist, belong to the same '
  'user, and already be accepted, and the actor must be ''user''. FR-02.';

-- ---------------------------------------------------------------------------
-- 2. the proposal boundary, as a trigger
-- ---------------------------------------------------------------------------
--
-- Written against NEW.proposal_id / NEW.user_id / NEW.actor only, so the same
-- function serves both history tables. Four rejections, each closing a way the
-- boundary could be claimed without being kept:
--
--   * a proposal that does not exist — a citation nobody can check is not
--     evidence;
--   * a proposal belonging to another user — otherwise one user's accepted
--     recommendation could launder a transition in another's project, even
--     from a service-role client that RLS does not constrain;
--   * a proposal still pending, dismissed or superseded — "accepted" is the
--     whole content of the requirement; a pending proposal is precisely the
--     state in which the model has proposed and the user has NOT agreed;
--   * actor <> 'user' — a proposal-driven transition is a *user* acting on a
--     suggestion. `actor = 'system'` together with a proposal_id is a model
--     owning a state transition with a recommendation stapled to it as cover,
--     which is the exact shape FR-02 forbids.

create or replace function public.stage_event_proposal_accepted()
returns trigger
language plpgsql
as $$
declare
  proposal_status text;
  proposal_user   uuid;
begin
  if new.proposal_id is null then
    return new;
  end if;

  select r.status, r.user_id
    into proposal_status, proposal_user
    from public.recommendations r
   where r.id = new.proposal_id;

  if not found then
    raise exception
      'proposal % does not exist; a stage transition cannot cite a recommendation that was never made',
      new.proposal_id
      using errcode = 'check_violation';
  end if;

  if proposal_user is distinct from new.user_id then
    raise exception
      'proposal % belongs to another user; a recommendation cannot authorise a transition outside its own project',
      new.proposal_id
      using errcode = 'check_violation';
  end if;

  if proposal_status <> 'accepted' then
    raise exception
      'proposal % is %, not accepted; the model may propose but the user has not agreed',
      new.proposal_id, proposal_status
      using errcode = 'check_violation';
  end if;

  if new.actor <> 'user' then
    raise exception
      'a proposal-driven transition is the user acting on a suggestion; actor was %',
      new.actor
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.stage_event_proposal_accepted() is
  'FR-02: a stage-history row may cite a recommendation only if that '
  'recommendation exists, belongs to the same user, has been accepted, and the '
  'actor is the user. Installed on workflow_events (the live log) and on '
  'project_stage_events (dormant) so the rule cannot hold on one and not the other.';

drop trigger if exists we_proposal_accepted on public.workflow_events;
create trigger we_proposal_accepted
  before insert or update on public.workflow_events
  for each row execute function public.stage_event_proposal_accepted();

drop trigger if exists pse_proposal_accepted on public.project_stage_events;
create trigger pse_proposal_accepted
  before insert or update on public.project_stage_events
  for each row execute function public.stage_event_proposal_accepted();

-- ---------------------------------------------------------------------------
-- 3. a resolved recommendation is settled
-- ---------------------------------------------------------------------------
--
-- `recs_owner_update` grants UPDATE to the owner, which is what lets a client
-- accept or dismiss its own recommendation. Unqualified, it also lets a client
-- rewrite an ACCEPTED recommendation's instruction, title or scope after an
-- event and a decision row have already cited it — leaving the audit trail
-- pointing at text nobody ever agreed to. The trail is the contract evidence
-- for FR-02, so the proposal's substance freezes the moment it is resolved.
--
-- Status moves forward only: pending -> accepted | dismissed | superseded,
-- and anything resolved -> superseded. Un-dismissing a recommendation is not
-- an edit, it is a new proposal; making that mechanically true is what stops
-- "the user rejected this" from being reversible after the fact.

create or replace function public.recommendations_resolution_forward_only()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    if new.kind             is distinct from old.kind
    or new.title            is distinct from old.title
    or new.summary          is distinct from old.summary
    or new.suggested_change is distinct from old.suggested_change
    or new.instruction      is distinct from old.instruction
    or new.rationale::text  is distinct from old.rationale::text
    or new.scope::text      is distinct from old.scope::text
    or new.tags::text       is distinct from old.tags::text
    or new.severity         is distinct from old.severity
    or new.project_id       is distinct from old.project_id
    or new.version_id       is distinct from old.version_id
    then
      raise exception
        'recommendation % is already %; its substance is cited by the decision trail and cannot be rewritten',
        old.id, old.status
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'superseded'
    or (old.status <> 'pending' and new.status <> 'superseded')
    or (old.status = 'pending' and new.status not in ('accepted', 'dismissed', 'superseded'))
    then
      raise exception
        'recommendation status moves forward only: % -> % is not allowed',
        old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- Owned by the database for the same reason `revision` is: a client that
    -- could set it could date a decision to whenever suited it.
    if new.status <> 'pending' and new.resolved_at is null then
      new.resolved_at = now();
    end if;
  end if;

  return new;
end;
$$;

comment on function public.recommendations_resolution_forward_only() is
  'A resolved recommendation is settled: its substance freezes and its status '
  'only moves forward. RLS grants UPDATE, so without this an accepted '
  'recommendation could be rewritten after an event cited it. FR-02.';

drop trigger if exists recs_forward_only on public.recommendations;
create trigger recs_forward_only
  before update on public.recommendations
  for each row execute function public.recommendations_resolution_forward_only();
