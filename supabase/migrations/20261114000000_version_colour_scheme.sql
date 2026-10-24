-- Sean, 22 Oct (emails 1 and 3): "when i change it, it changes for all
-- versions … should it automatically change colors for new versions? Or
-- should old versions change colors? Probably the former."
--
-- A version's colour came from its number and the palette the user has
-- picked now (`lib/appearance/colours.ts`, kept in the browser), so a new
-- palette recoloured every version ever made. The browser now records, on
-- each version it appends, the palette in force — "<starting>/<palette>",
-- e.g. "grey/calm" — and the version is drawn from that palette and its
-- number for good. A row without one (older versions, versions written
-- elsewhere) follows the current palette, as before.
--
-- Set on insert only: the immutability trigger already refuses any later
-- change except user_rating.
--
-- Idempotent: safe to re-run; applies to an empty database.

alter table public.artifact_versions
  add column if not exists colour_scheme text;

alter table public.artifact_versions
  drop constraint if exists artifact_versions_colour_scheme_chk;
alter table public.artifact_versions
  add constraint artifact_versions_colour_scheme_chk
    check (colour_scheme is null or colour_scheme ~ '^[a-z]{1,20}/[a-z]{1,20}$');
