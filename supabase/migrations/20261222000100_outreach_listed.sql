-- The Outreach workflow on the start screen (Sean, 26 Nov: a rough list of companies to personal
-- emails, approved and sent). Seeded unlisted (20261221000100) while it could not yet send; listed
-- now that it researches, drafts and sends what the user approves. Only `listed` may change on a
-- published template (20261113000000_workflow_template_listing.sql). Idempotent.
update public.workflow_templates
   set listed = true
 where key = 'email_outreach'
   and is_system
   and not listed;
