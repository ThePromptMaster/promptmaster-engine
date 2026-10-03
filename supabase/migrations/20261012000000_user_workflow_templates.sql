-- A user may publish a workflow of their own (3 Oct call: a workflow that
-- "designs itself", and "cards for different companies").
--
-- The table already anticipated it: `is_system` / `owner_id` and the
-- `wft_owner_chk` check, and the read policy lets an owner see their rows.
-- What was missing is a way in. A user's row is inserted published and is then
-- as immutable as a system one: there is no update or delete policy, so a
-- project pinned to it keeps the workflow it started on, and a revision is a
-- new key or version, exactly as for the system templates.

drop policy if exists "wft_insert_own" on public.workflow_templates;
create policy "wft_insert_own" on public.workflow_templates
  for insert to authenticated
  with check (
    not is_system
    and owner_id = auth.uid()
    and status = 'published'
    -- Own keys only: a user template can never shadow book / research / single_output.
    and key like 'custom\_%'
  );
