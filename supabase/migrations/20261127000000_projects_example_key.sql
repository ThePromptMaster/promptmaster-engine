-- A project started from a curated example's sample (the client's call, 4 Nov).
--
-- Null for every other project, including one that uses an example's workflow on
-- the user's own work. Two things read it: the stage that would draft itself on
-- entry does not, so nothing is spent until a press; and the start funnel on
-- /admin counts examples from it rather than from new telemetry.
--
-- Which examples exist is code (lib/projects/examples), not a table: it is not
-- user data. The check only keeps the column to what a key can be.

alter table public.projects add column if not exists example_key text;

alter table public.projects drop constraint if exists projects_example_key_chk;
alter table public.projects add constraint projects_example_key_chk
  check (example_key is null or example_key ~ '^[a-z][a-z0-9_]{0,39}$');

comment on column public.projects.example_key is
  'Curated example this project is the sample of, or null. Holds auto-drafting off; read by the start funnel.';
