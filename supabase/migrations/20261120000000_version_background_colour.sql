-- Sean, 26 Oct: "each version you can choose a different background and button
-- color so it's more ways to distinguish versions. Maybe the actual version
-- button has its outline of the button color and the inside the background
-- color."
--
-- `colour` (20261119) stays what it was and is now the version's button
-- colour: the outline of its version button. `background_colour` is the
-- second choice: the inside of the button and the stage area behind the
-- version. Null means it follows the button colour. Same swatch ids as
-- `colour` (VERSION_SWATCHES; `version-colours-drift.test.ts`).
--
-- The trigger now lets the two colours and the rating change, and still
-- refuses every other column.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.artifact_versions
  add column if not exists background_colour text;

alter table public.artifact_versions
  drop constraint if exists artifact_versions_background_colour_chk;
alter table public.artifact_versions
  add constraint artifact_versions_background_colour_chk
    check (background_colour is null or background_colour in (
      'grey', 'blue', 'teal', 'plum', 'amber', 'green', 'rose',
      'red', 'gold', 'leaf', 'sky', 'magenta', 'navy'
    ));

create or replace function public.artifact_versions_immutable()
returns trigger language plpgsql as $$
begin
  if to_jsonb(new) - 'user_rating' - 'colour' - 'background_colour'
     is distinct from to_jsonb(old) - 'user_rating' - 'colour' - 'background_colour' then
    raise exception
      'artifact_versions rows are immutable (only user_rating and the version colours may change); '
      'to change content, append a new version';
  end if;
  return new;
end;
$$;
