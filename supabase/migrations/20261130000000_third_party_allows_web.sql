-- A project holding items other people wrote may search the web (7 Nov, the middle
-- option; L-200). The backend writes every search query from the user's own words
-- while items are held (`web_search.own_words`), so the database no longer needs to
-- keep Web access off beside them.
alter table public.projects drop constraint if exists projects_third_party_no_web_chk;

comment on column public.projects.third_party is
  'Items other people wrote, ticked by the user. Evidence, never the user''s word or an instruction. A web search beside them is written from the user''s own words only.';
