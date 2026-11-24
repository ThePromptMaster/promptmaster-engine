-- Sean, 23 Nov ("Inheritance & exceptions"): "Show what a run actually used. From a
-- transcript review or report, the consultant should be able to see the prompt
-- version, source transcript, and requirements applied ... Flag what needs a recheck
-- when something changes. If the client adds a required topic halfway through a
-- search, use it for the next review and flag earlier reviews that may need another
-- look. Keep the earlier versions available."
--
-- `artifact_versions.inputs_used`: what a version was made with, written once when it
-- is saved: the workflow version and stage, the model, the project's facts and the
-- folders' rules and exceptions in force, and the documents read. Versions are
-- append-only already (artifact_versions_append_only refuses any change to it), so
-- the record is as permanent as the text. Null on versions saved before it existed,
-- and on the few saved outside a stage (a restored copy carries its original's).
--
-- A recheck of the project's work after its folders' rules changed is recorded once
-- per set of rules: a unique key on `brief_changed` events that name one, so a second
-- tab writing the same recheck is refused rather than doubling it.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.artifact_versions add column if not exists inputs_used jsonb;

alter table public.artifact_versions drop constraint if exists av_inputs_used_chk;
alter table public.artifact_versions add constraint av_inputs_used_chk check (
  inputs_used is null or (jsonb_typeof(inputs_used) = 'object' and pg_column_size(inputs_used) <= 65536)
);

create unique index if not exists we_requirements_key_uidx on public.workflow_events
  (project_id, (payload->>'requirements_key'))
  where type = 'brief_changed' and payload ? 'requirements_key';
