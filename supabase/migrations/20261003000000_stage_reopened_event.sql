-- C5 (Sean, 28 Sep, item 16): a done stage can be reopened for editing
-- without moving the project's cursor. Closing it again is the existing
-- stage_marked_complete; when that cites different evidence than before, the
-- engine marks the work after it stale ("recheck"), from the events alone.
--
-- Reopening is the user's decision: never an agent run's.
--
-- Idempotent: safe to re-run.

alter table public.workflow_events drop constraint if exists we_type_chk;
alter table public.workflow_events add constraint we_type_chk check (type in (
  'project_created', 'stage_entered', 'stage_completed', 'stage_skipped',
  'stage_returned', 'outline_approved', 'outline_version_created',
  'section_written', 'section_regenerated', 'job_enqueued', 'job_failed',
  'generation_paused', 'generation_resumed', 'imported_from_session',
  'stage_marked_complete', 'stage_advanced', 'stage_blocked', 'stage_unblocked',
  'project_finalized', 'project_reopened', 'template_upgraded', 'stage_reopened'));

alter table public.workflow_events drop constraint if exists we_reopen_user_chk;
alter table public.workflow_events add constraint we_reopen_user_chk check (
  type <> 'stage_reopened' or (actor = 'user' and agent_run_id is null)
);
