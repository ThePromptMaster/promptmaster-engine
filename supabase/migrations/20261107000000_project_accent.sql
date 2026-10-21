-- T2 (14 Oct call): "the whole thing could change color based on what project
-- you're working on."
--
-- `projects.accent`: the project's own accent colour, one of the accents the
-- colour picker offers (`ACCENTS` in frontend/src/lib/appearance/colours.ts;
-- `accent-drift.test.ts` keeps this list equal to it). Null means the user's
-- own choice for every project, as before.
--
-- Idempotent: safe to re-run.

alter table public.projects add column if not exists accent text;
alter table public.projects drop constraint if exists projects_accent_chk;
alter table public.projects add constraint projects_accent_chk
  check (accent is null or accent in ('slate', 'teal', 'plum', 'forest', 'rust', 'ink'));
