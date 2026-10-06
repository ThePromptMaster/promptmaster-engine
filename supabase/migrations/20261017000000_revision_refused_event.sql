-- G1 (Sean, 5 Oct): "The revision should fail validation, the populated
-- artifact should remain current … The failed attempt should remain visible
-- in history."
--
-- A revision the commit check refuses (lib/workflow/commit-check.ts) is
-- recorded as an event: what tried to save, and why it was refused. It moves
-- no stage state — the projection ignores it — so a system actor may record it
-- without a run (the agent-authorization guard only governs stage moves).
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
  'revision_refused'));
