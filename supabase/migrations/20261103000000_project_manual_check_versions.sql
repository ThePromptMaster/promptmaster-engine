-- 19 Oct (Research › Method screenshot): the user approved the analysis plan,
-- Go then saved a newer version, and nothing said which version the tick was
-- for. Each ticked approval records the stage version it was given on, so the
-- checklist can say "approved v3 · current v4".
--
-- { criterion_id: artifact_version_id }. Display only: it never gates a stage.
--
-- Idempotent: safe to re-run.

alter table public.projects
  add column if not exists manual_check_versions jsonb not null default '{}'::jsonb;
