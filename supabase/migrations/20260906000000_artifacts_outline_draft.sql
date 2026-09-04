-- The outline's working copy.
--
-- Outline VERSIONS are JSON in artifact_versions.content, which is what makes
-- outline history the same thing as version history: restore, provenance and
-- the immutability trigger all work on an outline for free.
--
-- But immutability is exactly why a draft cannot be a version. FR-07 requires
-- copy-on-write with two distinct behaviours: editing an APPROVED outline
-- clones it into a new draft, while editing a DRAFT mutates in place. A row in
-- artifact_versions can never be mutated in place — the trigger added in
-- projects_core rejects it — so persisting every keystroke as a version would
-- either forbid the second behaviour or bury the real, approved outlines under
-- a pile of half-typed ones in the restore list.
--
-- So the draft lives on the artifact row, which is mutable and already carries
-- exactly this kind of working state (long_form, for the same reason). The
-- shape is an OutlineDocument: {schema, items[], orphans[], forked_from_version_id}.
-- Committing a draft appends it as a version and clears this column; approval
-- then points at that version.

alter table public.artifacts
  add column if not exists outline_draft jsonb;

comment on column public.artifacts.outline_draft is
  'Uncommitted OutlineDocument. Cleared when the draft is committed as a version.';
