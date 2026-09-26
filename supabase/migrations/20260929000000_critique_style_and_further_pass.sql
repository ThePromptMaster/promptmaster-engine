-- Phase C1: critique intensity and communication tone (PM-21), and "no further
-- AI pass needed" (PM-25).
--
-- PM-21, Sean, Sep 10: "Tone and rigor should be separable: strong critique
-- does not always need harsh wording; user should be able to choose critique
-- intensity / communication tone." Two columns, not one, because they are two
-- decisions: how hard to look, and how to say what was found. A project
-- remembers both; every evaluation and critique on it reads them.
--
-- PM-25: "The system should sometimes recognize when no further AI action is
-- needed rather than always encouraging another pass." The evaluator now says
-- so explicitly, and the answer is stored with the evaluation it belongs to —
-- null for every evaluation written before this, which the UI reads as "not
-- stated", never as "needed".

alter table public.projects
  add column if not exists critique_intensity text not null default 'standard',
  add column if not exists critique_tone text not null default 'neutral';

alter table public.projects drop constraint if exists projects_critique_intensity_chk;
alter table public.projects add constraint projects_critique_intensity_chk
  check (critique_intensity in ('light', 'standard', 'rigorous'));

alter table public.projects drop constraint if exists projects_critique_tone_chk;
alter table public.projects add constraint projects_critique_tone_chk
  check (critique_tone in ('gentle', 'neutral', 'direct'));

alter table public.evaluations
  add column if not exists further_pass_needed boolean,
  add column if not exists further_pass_reason text;
