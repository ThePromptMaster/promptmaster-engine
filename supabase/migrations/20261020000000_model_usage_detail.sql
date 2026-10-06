-- E1 (Sean, 5 Oct): "measure model/tool costs, elapsed time, … retries, and
-- repair work on matched tasks."
--
-- model_usage recorded what a call cost but not how long it took, what it was
-- for beyond the HTTP route, or whether it was a retry or a JSON repair pass.
-- These columns make a project's cost explainable: which operations, how slow,
-- and how much of it was rework. All nullable — rows written before this
-- migration, and by older clients, simply lack them.
--
-- Still insert-and-select only (20260910000000): no update policy is added.
--
-- Idempotent: safe to re-run.

alter table public.model_usage add column if not exists elapsed_ms integer;
alter table public.model_usage add column if not exists operation text;
alter table public.model_usage add column if not exists attempt text;
alter table public.model_usage add column if not exists agent_step_id uuid;

alter table public.model_usage drop constraint if exists model_usage_attempt_chk;
alter table public.model_usage add constraint model_usage_attempt_chk
  check (attempt is null or attempt in ('first', 'retry', 'repair'));
alter table public.model_usage drop constraint if exists model_usage_elapsed_chk;
alter table public.model_usage add constraint model_usage_elapsed_chk
  check (elapsed_ms is null or elapsed_ms >= 0);

create index if not exists model_usage_project_idx on public.model_usage (project_id, created_at desc);
