-- A stage artifact carries its own summary.
--
-- Generating stage N needs to know what stages 1..N-1 concluded. Sending the
-- artifacts themselves does not scale: by stage ten of a Book project that is
-- most of a manuscript in every prompt, and the instruction that matters is
-- buried under it.
--
-- So each stage contributes a short projection instead, and the digest the
-- client assembles is O(stages x constant) rather than O(project).
--
-- The summary is stored here, written once when the stage completes, rather
-- than recomputed on every generation. Storing it also means a later edit to
-- an upstream stage does not silently rewrite the context that downstream
-- stages were already generated against — the record says what the next stage
-- was actually told.
--
-- Nullable: artifacts that predate this, and stages still in progress, simply
-- have none, and the client falls back to projecting the head version.

alter table public.artifacts
  add column if not exists summary text;
