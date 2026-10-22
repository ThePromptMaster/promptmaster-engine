-- The order sources were saved in (22 Oct). A project's sources are cited as
-- [S1], [S2], … in the order they were saved, and were listed by `created_at`
-- — but one search saves its sources in one insert, and every row of one
-- insert has the same `created_at`. Their order then depended on Postgres
-- returning tied rows as they were written, which nothing guarantees: [S3] in
-- a reply could have been listed as [S4].
--
-- An identity column is numbered in the order the rows are written, so a
-- search's sources keep the order the reply cited them in. Existing rows are
-- numbered as the table holds them, which is the order they are listed today.
-- `generated always`: a client cannot set it, and it cannot be updated, so the
-- append-only trigger needs no change.
--
-- Idempotent: safe to re-run.

alter table public.project_sources
  add column if not exists seq bigint generated always as identity;

create index if not exists project_sources_project_seq_idx on public.project_sources (project_id, seq);
