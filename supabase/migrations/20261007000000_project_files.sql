-- Data a user attaches to a project, for code the project runs.
--
-- Until now a project could hold only what was typed into it. Experiment
-- therefore planned analyses it could never run: asked "can PromptMaster
-- ingest a CSV, query a dataset, run statistics?", the honest answer was
-- that the sandbox ran Python with no input files at all (the client's 1 Oct
-- feedback, items 16 and 17). A file attached here is copied into the sandbox
-- at /data when the project runs code, and nowhere else.
--
-- The backend still owns no data: rows and objects are written by the browser
-- under RLS, and read by the sandbox route with the service role after it has
-- checked the caller owns the project.

create table if not exists public.project_files (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 200),
  -- '<user id>/<project id>/<file id>-<name>' in the project-files bucket.
  path          text not null unique,
  content_type  text not null default 'text/plain',
  bytes         integer not null check (bytes >= 0 and bytes <= 5000000),
  -- Column names, the first few rows and the row count, computed in the
  -- browser at upload. It is what the model is shown: enough to write code
  -- against the file, without the file itself ever going to a model.
  preview       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  -- An object cannot be parented into another user's project, even by a
  -- service-role client.
  constraint project_files_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint project_files_name_once unique (project_id, name)
);

create index if not exists project_files_project_idx on public.project_files (project_id, created_at);

alter table public.project_files enable row level security;

drop policy if exists "project_files_select_own" on public.project_files;
create policy "project_files_select_own" on public.project_files
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "project_files_insert_own" on public.project_files;
create policy "project_files_insert_own" on public.project_files
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "project_files_delete_own" on public.project_files;
create policy "project_files_delete_own" on public.project_files
  for delete to authenticated using (user_id = auth.uid());

-- No update policy: a file is replaced by removing it and adding another, so
-- a run's record of what it read cannot be changed underneath it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 5000000)
on conflict (id) do nothing;

drop policy if exists "project_files_owner_read" on storage.objects;
create policy "project_files_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "project_files_owner_write" on storage.objects;
create policy "project_files_owner_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "project_files_owner_delete" on storage.objects;
create policy "project_files_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
