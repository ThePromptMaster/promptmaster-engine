-- 13 Oct (Sean, 12.7): "Go uses Architect even when Critique recommends Cold
-- Critic." Each stage's recommended mode is used for that stage's work unless
-- the user keeps their own mode on every stage.
--
-- 'stage'   — a stage with a recommended mode is worked in it (the default);
-- 'project' — the project's mode on every stage, as before.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists stage_modes text not null default 'stage';
alter table public.projects drop constraint if exists projects_stage_modes_chk;
alter table public.projects add constraint projects_stage_modes_chk
  check (stage_modes in ('stage', 'project'));
