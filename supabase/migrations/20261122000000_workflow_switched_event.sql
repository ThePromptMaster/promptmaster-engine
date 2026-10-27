-- Sean, 26 Oct: "You type what you want and get an answer or draft up front
-- … Then there's a clear button to take that same work into the full
-- PromptMaster process … Everything carries over so you're building on what
-- you already made."
--
-- A Quick answer project is re-pinned to a full workflow in place, so its
-- chat, facts, sources and files stay where they are. `workflow_switched`
-- records the move (payload: from_template_id, to_template_id,
-- deliverable_stage_id). The log before it is kept as the record; the browser
-- projects stage state from the events after it (`liveEvents`). The browser
-- records it as the user's press; Go has no action that writes it.
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
  'brief_changed', 'brief_change_dismissed', 'objective_assessed',
  'stage_version_saved', 'web_access_changed', 'stage_added', 'workflow_switched'));
