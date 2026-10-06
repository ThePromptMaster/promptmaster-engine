-- C1 (Sean, 5 Oct): a change to the brief reopens only the finished work that
-- relied on it.
--
-- brief_changed records the change and which stages it reopened, with why;
-- the projection marks only those for a recheck. brief_change_dismissed is
-- the user keeping them as they were. Both are the user's: the change is their
-- edit, and keeping the work is their call. Neither moves the cursor.
--
-- The type list repeats every value added since 20261003 (revision_refused,
-- routine_policy_changed, criterion_committed), so it is right whichever of
-- those migrations a database already has.
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
  'brief_changed', 'brief_change_dismissed'));

alter table public.workflow_events drop constraint if exists we_brief_change_user_chk;
alter table public.workflow_events add constraint we_brief_change_user_chk check (
  type not in ('brief_changed', 'brief_change_dismissed') or (actor = 'user' and agent_run_id is null)
);
