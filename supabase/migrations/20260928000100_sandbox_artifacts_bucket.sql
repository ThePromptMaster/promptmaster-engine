-- B3: files a sandbox run writes to /out (plots, CSVs), kept next to the run.
--
-- Private. Objects live under <user_id>/<run_id>/<sandbox_run_id>/<name>, are
-- written only by /api/sandbox/run with the service role, and are readable
-- only by the user whose folder they are in — the same shape as sandbox_runs
-- itself: the owner can look, nobody but the server can write.

insert into storage.buckets (id, name, public, file_size_limit)
values ('sandbox-artifacts', 'sandbox-artifacts', false, 1000000)
on conflict (id) do nothing;

drop policy if exists "sandbox_artifacts_owner_read" on storage.objects;
create policy "sandbox_artifacts_owner_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'sandbox-artifacts' and (storage.foldername(name))[1] = auth.uid()::text);
