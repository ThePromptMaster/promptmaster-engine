-- Who outreach email goes out as (Sean, 26 Nov: "Save reusable signatures by sender or brand …
-- with the company logo underneath the signature … Give me a place to set the sender
-- information and opt-out details for commercial outreach").
--
-- Per user, owner-only under RLS, like user_preferences: nothing here is project data.
--   outreach_settings  one row: daily cap, spacing between sends, a pause on everything.
--   outreach_senders   a sending identity: the connected mailbox it sends from, the From name,
--                      Reply-To, and the postal address and opt-out line a commercial email carries.
--   outreach_signatures a signature for a sender: name, title, company, website, links, and a logo
--                      underneath; a first-email one and a shorter one for replies.
--   outreach_logos     an uploaded logo. Never updated or deleted: an email already sent shows it
--                      from its public address.
--
-- A signature or sender can be edited. What an approved email said is kept whole in its
-- approval (a later migration), so an edit never changes a record of what was sent; an edit
-- makes an approved, unsent email different from what was approved, and it is held.
--
-- The logo bucket is public: a recipient's mail program loads the image from its address with
-- no sign-in. Paths are random (l/<uuid>.<ext>), never a user id, and an upload is allowed only
-- for a path the uploader has registered in outreach_logos first. No SVG: Gmail does not show it,
-- and it can carry script.
--
-- Idempotent: safe to re-run.

create table if not exists public.outreach_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_cap integer not null default 50,
  spacing_seconds integer not null default 45,
  paused boolean not null default false,
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);
alter table public.outreach_settings drop constraint if exists outreach_settings_cap_chk;
alter table public.outreach_settings add constraint outreach_settings_cap_chk check (daily_cap between 1 and 400);
alter table public.outreach_settings drop constraint if exists outreach_settings_spacing_chk;
alter table public.outreach_settings add constraint outreach_settings_spacing_chk check (spacing_seconds between 30 and 3600);
alter table public.outreach_settings drop constraint if exists outreach_settings_tz_chk;
alter table public.outreach_settings add constraint outreach_settings_tz_chk check (char_length(timezone) between 1 and 64);

create table if not exists public.outreach_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  toolkit text not null,
  from_name text not null default '',
  from_address text not null,
  reply_to text,
  postal_address text not null default '',
  opt_out_line text not null default '',
  commercial boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.outreach_senders drop constraint if exists outreach_senders_toolkit_chk;
alter table public.outreach_senders add constraint outreach_senders_toolkit_chk check (toolkit in ('gmail', 'outlook'));
alter table public.outreach_senders drop constraint if exists outreach_senders_fields_chk;
alter table public.outreach_senders add constraint outreach_senders_fields_chk check (
  char_length(from_name) <= 120
  and char_length(from_address) between 3 and 320
  and from_address = lower(from_address)
  and position('@' in from_address) > 1
  and (reply_to is null or (char_length(reply_to) <= 320 and position('@' in reply_to) > 1))
  and char_length(postal_address) <= 500
  and char_length(opt_out_line) <= 300
);
create index if not exists outreach_senders_user_idx on public.outreach_senders (user_id);

create table if not exists public.outreach_logos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null unique,
  mime text not null,
  width integer not null,
  height integer not null,
  bytes integer not null,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.outreach_logos drop constraint if exists outreach_logos_fields_chk;
alter table public.outreach_logos add constraint outreach_logos_fields_chk check (
  path ~ '^l/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif)$'
  and mime in ('image/png', 'image/jpeg', 'image/gif')
  and width between 1 and 4000 and height between 1 and 4000
  and bytes between 1 and 300000
);

create table if not exists public.outreach_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_id uuid not null,
  kind text not null default 'first',
  label text not null default '',
  name text not null default '',
  title text not null default '',
  company text not null default '',
  website text not null default '',
  links jsonb not null default '[]'::jsonb,
  logo_id uuid,
  logo_width integer not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (sender_id, user_id) references public.outreach_senders (id, user_id) on delete cascade,
  foreign key (logo_id, user_id) references public.outreach_logos (id, user_id)
);
alter table public.outreach_signatures drop constraint if exists outreach_signatures_fields_chk;
alter table public.outreach_signatures add constraint outreach_signatures_fields_chk check (
  kind in ('first', 'reply')
  and char_length(label) <= 80
  and char_length(name) <= 120 and char_length(title) <= 120 and char_length(company) <= 120
  and (website = '' or (website ~ '^https://' and char_length(website) <= 300))
  and jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4 and pg_column_size(links) < 2000
  and logo_width between 40 and 300
);
create index if not exists outreach_signatures_sender_idx on public.outreach_signatures (sender_id);

-- Owner-only. Logos: select and insert only.
alter table public.outreach_settings enable row level security;
alter table public.outreach_senders enable row level security;
alter table public.outreach_signatures enable row level security;
alter table public.outreach_logos enable row level security;

drop policy if exists outreach_settings_select on public.outreach_settings;
create policy outreach_settings_select on public.outreach_settings for select using (auth.uid() = user_id);
drop policy if exists outreach_settings_insert on public.outreach_settings;
create policy outreach_settings_insert on public.outreach_settings for insert with check (auth.uid() = user_id);
drop policy if exists outreach_settings_update on public.outreach_settings;
create policy outreach_settings_update on public.outreach_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists outreach_senders_select on public.outreach_senders;
create policy outreach_senders_select on public.outreach_senders for select using (auth.uid() = user_id);
drop policy if exists outreach_senders_insert on public.outreach_senders;
create policy outreach_senders_insert on public.outreach_senders for insert with check (auth.uid() = user_id);
drop policy if exists outreach_senders_update on public.outreach_senders;
create policy outreach_senders_update on public.outreach_senders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists outreach_senders_delete on public.outreach_senders;
create policy outreach_senders_delete on public.outreach_senders for delete using (auth.uid() = user_id);

drop policy if exists outreach_signatures_select on public.outreach_signatures;
create policy outreach_signatures_select on public.outreach_signatures for select using (auth.uid() = user_id);
drop policy if exists outreach_signatures_insert on public.outreach_signatures;
create policy outreach_signatures_insert on public.outreach_signatures for insert with check (auth.uid() = user_id);
drop policy if exists outreach_signatures_update on public.outreach_signatures;
create policy outreach_signatures_update on public.outreach_signatures for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists outreach_signatures_delete on public.outreach_signatures;
create policy outreach_signatures_delete on public.outreach_signatures for delete using (auth.uid() = user_id);

drop policy if exists outreach_logos_select on public.outreach_logos;
create policy outreach_logos_select on public.outreach_logos for select using (auth.uid() = user_id);
drop policy if exists outreach_logos_insert on public.outreach_logos;
create policy outreach_logos_insert on public.outreach_logos for insert with check (auth.uid() = user_id);

-- The bucket. Reads are public (no select policy needed for a public bucket's object URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-logos', 'email-logos', true, 300000, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "email_logos_registered_insert" on storage.objects;
create policy "email_logos_registered_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-logos'
    and exists (select 1 from public.outreach_logos l where l.path = storage.objects.name and l.user_id = auth.uid())
  );
