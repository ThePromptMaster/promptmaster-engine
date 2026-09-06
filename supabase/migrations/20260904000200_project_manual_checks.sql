-- Manual exit criteria are project state, not UI state.
--
-- A criterion like "says what is out of scope" cannot be computed, so the user
-- ticks it. That tick has to survive a reload and be visible to anyone else
-- opening the project — keeping it in component state or localStorage would
-- make the stage look incomplete to the same user on another machine.
--
-- JSONB keyed by criterion id rather than a table: this is a small map read
-- and written with the project itself, and a row per checkbox buys nothing.

alter table public.projects
  add column if not exists manual_checks jsonb not null default '{}'::jsonb;
