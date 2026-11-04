-- A sample of what good looks like (4 Nov, Sean: "we could test an optional
-- field for source material or a sample output. That would give the app a
-- concrete standard for depth and style when the user wants one").
--
-- Optional, per project, written by the browser under the projects RLS like
-- every other brief field. Prompts read it as a standard to match, never as a
-- source (backend promptmaster/project_context.py::sample_block). copy_project
-- copies every column, so a copy keeps it.
alter table public.projects add column if not exists sample_output text;

alter table public.projects drop constraint if exists projects_sample_output_len;
alter table public.projects add constraint projects_sample_output_len
  check (sample_output is null or char_length(sample_output) <= 60000);
