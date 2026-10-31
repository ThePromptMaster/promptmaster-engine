-- 31 Oct: a project another one draws on is read as it was when it was
-- chosen, not as it is now — "more like a copy thing rather than combining
-- them so you have the original project too as well kind of like the
-- versions". The reference keeps a copy of what it brings (the deliverable's
-- text, the facts, the title) and the time it was taken; "Update from the
-- original" takes it again. The original project is never written to.
--
-- The owner's existing update policy covers these columns. A reference made
-- before this keeps reading the original until the browser stores its first
-- snapshot.

alter table public.project_references add column if not exists snapshot jsonb;
alter table public.project_references add column if not exists snapshot_at timestamptz;
