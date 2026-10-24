-- Sean, 23 Oct (email 7): "the number of my workflow presets are getting
-- outrageous lol maybe a way to delete or store them".
--
-- Every workflow a user designs is published as its own `custom_` row, and
-- the start screen lists every one. A row cannot be deleted: projects pin the
-- exact version they started on (`projects.workflow_template_id`, on delete
-- set null), and a project with no template has no stages. So a preset is put
-- away instead:
--
--   status 'archived'  — "Remove from list": kept for the projects pinned to
--                        it, no longer offered on the start screen. The status
--                        already allowed 'archived'; nothing used it.
--   listed false       — a workflow designed for one project (24 Oct: a
--                        custom workflow by default) that the user has not
--                        saved as a preset: it never joins the list at all.
--
-- The owner may change those two columns and nothing else, on their own
-- non-system rows. Content stays immutable, as `20261012000000` promised:
-- the trigger refuses any other change, so a pinned project still gets
-- exactly the workflow it started on.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.workflow_templates
  add column if not exists listed boolean not null default true;

drop policy if exists "wft_update_listing_own" on public.workflow_templates;
create policy "wft_update_listing_own" on public.workflow_templates
  for update to authenticated
  using (not is_system and owner_id = auth.uid())
  with check (not is_system and owner_id = auth.uid() and status in ('published', 'archived'));

create or replace function public.workflow_templates_listing_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'status' - 'listed') is distinct from (to_jsonb(old) - 'status' - 'listed') then
    raise exception 'A published workflow cannot be changed; only whether it is listed (status, listed).'
      using errcode = 'check_violation';
  end if;
  if old.status = 'draft' or new.status = 'draft' then
    raise exception 'A workflow is listed or archived, never returned to draft.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_templates_listing_only on public.workflow_templates;
create trigger workflow_templates_listing_only
  before update on public.workflow_templates
  for each row execute function public.workflow_templates_listing_only();
