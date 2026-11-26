-- How a workspace lays out its folders (Sean, 26 Nov): "could Executive Search
-- be a workspace template, alongside a blank workspace with regular folders and
-- subfolders? … organize projects by whatever makes sense for them, like
-- location or department. The same rules for what carries down from a parent
-- folder should work in both setups."
--
-- Only wording follows from it, like `kind`: under an executive search
-- workspace a new folder is a client, and under a client a search; under a
-- blank workspace it is a folder. Nothing that carries down — rules, required
-- rules, exceptions, held work, workflows offered — reads it. Null on a
-- workspace made before this reads as executive search, which is what those
-- were made as (the sample, and "New workspace" since 24 Nov).

alter table public.project_folders add column if not exists layout text;

alter table public.project_folders drop constraint if exists project_folders_layout_chk;
alter table public.project_folders add constraint project_folders_layout_chk
  check (layout is null or layout in ('blank', 'executive_search'));

comment on column public.project_folders.layout is
  'A workspace''s template: blank (folders the user names) or executive_search (client › search). Wording only.';
