-- Q1 (14 Oct call): "maybe use a better model or increase the thinking level".
--
-- `projects.thinking`: how hard the model is asked to think for this project.
-- 'standard' is what every project did before (low effort on writing calls);
-- 'deep' sends high reasoning effort on every call the project makes. The
-- browser sends it as the X-PromptMaster-Thinking header and the backend, which
-- owns no data, applies it to the request; usage rows record the cost.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists thinking text not null default 'standard';
alter table public.projects drop constraint if exists projects_thinking_chk;
alter table public.projects add constraint projects_thinking_chk check (thinking in ('standard', 'deep'));
