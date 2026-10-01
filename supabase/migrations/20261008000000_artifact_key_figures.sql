-- The figures a stage established, kept beside its summary.
--
-- Later stages are given earlier ones as a few lines of summary, with no
-- channel for the numbers in them. A validation stage could therefore restate
-- a calculation from its own reading of the prose and arrive somewhere else
-- (the client's 1 Oct feedback, item 32: "downstream stages should reference
-- canonical calculations/results from project state rather than regenerate
-- numbers independently from prose"). When a stage is completed its figures
-- are recorded here, each as the value exactly as the stage wrote it, with the
-- version they were read from; later stages are handed them to quote.
--
-- Shape: { "version_id": "<artifact_versions.id>", "figures": [ { "name", "value", "context" } ] }

alter table public.artifacts
  add column if not exists key_figures jsonb not null default '{}'::jsonb;
