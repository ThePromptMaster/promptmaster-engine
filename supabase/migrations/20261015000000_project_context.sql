-- Project context (4 Oct test note #7).
--
-- A board-level brief pasted into the objective was refused at the objective's
-- limit. The objective should stay short and authoritative; the facts,
-- figures and background behind it are the project's source material and go
-- here. Carried into every stage prompt beside the objective (PMInput.context,
-- capped server-side at MAX_CONTEXT_CHARS), never treated as instructions.
--
-- No length check in the database: the cap is a prompt-cost control and
-- lives with the other prompt caps in backend/promptmaster/limits.py.
-- Idempotent: safe to re-run.

alter table public.projects
  add column if not exists context text not null default '';
