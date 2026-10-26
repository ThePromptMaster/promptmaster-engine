-- Sean, 25 Oct (email 4): "the whole background color should change with that
-- version … you should be able to change each versions colors".
--
-- A version's colour was fixed at creation (`colour_scheme`, 20261114). The
-- user may now choose one for a version: `colour`, an id from the swatch list
-- in `lib/appearance/colours.ts` (VERSION_SWATCHES; `version-colours-drift.test.ts`
-- keeps the two lists equal). Null means the colour it was made with.
--
-- It is the one display field a version may change after it is written,
-- beside `user_rating`. Content, provenance and order stay immutable: the
-- trigger below still refuses every other column, so restore and history keep
-- trusting the rows. The owner update policy (`artifact_versions_owner_rate`)
-- already limits updates to the row's owner.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.artifact_versions
  add column if not exists colour text;

alter table public.artifact_versions
  drop constraint if exists artifact_versions_colour_chk;
alter table public.artifact_versions
  add constraint artifact_versions_colour_chk
    check (colour is null or colour in (
      'grey', 'blue', 'teal', 'plum', 'amber', 'green', 'rose',
      'red', 'gold', 'leaf', 'sky', 'magenta', 'navy'
    ));

create or replace function public.artifact_versions_immutable()
returns trigger language plpgsql as $$
begin
  if to_jsonb(new) - 'user_rating' - 'colour' is distinct from to_jsonb(old) - 'user_rating' - 'colour' then
    raise exception
      'artifact_versions rows are immutable (only user_rating and colour may change); '
      'to change content, append a new version';
  end if;
  return new;
end;
$$;
