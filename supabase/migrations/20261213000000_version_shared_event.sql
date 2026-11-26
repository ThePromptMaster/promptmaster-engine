-- Which version people already received (Sean, 25 Nov: "The user should be able
-- to see what changed, why it changed, and which version people already
-- received"). A record that a stage's version was sent, shared or handed over,
-- in the user's own words: to whom, on which day, how. It is the user's word,
-- nothing checks it, and nothing in the stage's state reads it (`projectState`
-- ignores it): it is shown beside the versions and in what a change touched.
--
-- An event rather than a table: workflow_events is already append-only for its
-- owner and loaded with the page, and a copy of a project carries it. Undoing a
-- record, or saying an older version stays with its readers, is a later event.

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
  'stage_version_saved', 'web_access_changed', 'stage_added', 'workflow_switched',
  'criterion_not_applicable', 'approval_left_to_go', 'inherited_checked', 'inherited_hold',
  'version_shared'));

-- Only the user records what they sent; a run never does, and it names the version.
alter table public.workflow_events drop constraint if exists we_shared_chk;
alter table public.workflow_events add constraint we_shared_chk check (
  type <> 'version_shared'
  or (actor = 'user' and agent_run_id is null and payload ? 'version_id')
);
