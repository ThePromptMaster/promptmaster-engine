-- ===========================================================================
-- Richer stage statuses and objective-based completion (PM-13, PM-14)
-- ===========================================================================
--
-- Sean, Sep 10: "A stage should not automatically count as complete just
-- because the user advanced through it. It may need statuses such as: in
-- progress; completed; completed with evidence/artifact; skipped
-- intentionally; blocked." and "Project completion should depend on the actual
-- objective/artifact being completed, not just every workflow stage being
-- checked off."
--
-- Stage state is still projected from workflow_events in exactly one place
-- (projectState in frontend/src/lib/workflow/engine.ts). This migration only
-- widens what the log can say:
--
--   stage_marked_complete  the stage's work is done; payload may name the
--                          version that is the evidence (validated below)
--   stage_advanced         the cursor moved on with the stage NOT complete —
--                          "Continue anyway" past unmet requirements
--   stage_blocked          cannot proceed; needs a reason and a block_kind
--   stage_unblocked        the block is lifted
--   project_finalized      the project is finished
--   project_reopened       …and taken back up
--   template_upgraded      re-pinned to a newer workflow version
--
-- The legacy stage_completed keeps its meaning, so every existing log projects
-- exactly as it did. New code stops writing it.

alter table public.workflow_events drop constraint if exists we_type_chk;
alter table public.workflow_events add constraint we_type_chk check (type in (
  'project_created', 'stage_entered', 'stage_completed', 'stage_skipped',
  'stage_returned', 'outline_approved', 'outline_version_created',
  'section_written', 'section_regenerated', 'job_enqueued', 'job_failed',
  'generation_paused', 'generation_resumed', 'imported_from_session',
  'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked',
  'project_finalized', 'project_reopened', 'template_upgraded'));

-- A block without a reason and a kind is unrepresentable, mirroring the rule
-- that a skip without a reason is.
alter table public.workflow_events drop constraint if exists we_block_reason_chk;
alter table public.workflow_events add constraint we_block_reason_chk check (
  type <> 'stage_blocked'
  or (
    coalesce(reason, '') <> ''
    and payload->>'block_kind' in ('tool_missing', 'data_missing', 'needs_decision')
  )
);

-- decisions_type_chk is deliberately NOT widened: it is FR-02 contract
-- evidence (proposal-boundary.test.ts pins it). Stage state is recorded in
-- workflow_events, which is where it is projected from.

-- "Completed with artifact" is a fact the database checks, not a label: the
-- evidence version must belong to an artifact of the same stage and project.
create or replace function public.workflow_events_evidence_valid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  evidence uuid;
begin
  if new.type <> 'stage_marked_complete' or not (new.payload ? 'evidence_version_id') then
    return new;
  end if;

  begin
    evidence := (new.payload->>'evidence_version_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'evidence_version_id is not a uuid' using errcode = 'check_violation';
  end;

  if not exists (
    select 1
    from public.artifact_versions v
    join public.artifacts a on a.id = v.artifact_id
    where v.id = evidence
      and v.project_id = new.project_id
      and a.stage_id = new.stage_id
  ) then
    raise exception 'evidence version % is not an artifact of stage % in this project', evidence, new.stage_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists workflow_events_evidence_valid on public.workflow_events;
create trigger workflow_events_evidence_valid
  before insert on public.workflow_events
  for each row execute function public.workflow_events_evidence_valid();
