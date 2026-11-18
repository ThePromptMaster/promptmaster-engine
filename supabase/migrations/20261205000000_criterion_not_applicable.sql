-- 18 Nov 2026 (Sean, Executive Search): a designed workflow gave a role brief the
-- sign-off "I accept any new commitments this brief proposes", and the brief said in
-- so many words that it proposed none. Go stopped for a sign-off with nothing to sign.
--
-- criterion_not_applicable records that a sign-off does not apply to one version:
-- written by the page (actor system, no run) after a check of that version found
-- it proposes no new commitment, with the passage that shows it; or by the user
-- (actor user) saying it does apply after all. The projection treats the sign-off
-- as met only while that version is the stage's newest, so a later version that
-- adds a commitment needs the user's sign-off again.
--
-- The type list is the live one (which had grown past the last migration that wrote
-- it) plus the new type. Idempotent; applies against an empty database.

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
  'criterion_not_applicable'));

alter table public.workflow_events drop constraint if exists we_criterion_not_applicable_chk;
alter table public.workflow_events add constraint we_criterion_not_applicable_chk check (
  type <> 'criterion_not_applicable'
  or (payload ? 'criterion_id' and payload ? 'version_id' and agent_run_id is null and actor in ('user', 'system'))
);
