-- Plan 5 (stats/diary, unused items, For you, account deletion/export)
-- database layer: a 'donated' garment_status value, a client-writable
-- garments.pinned_on date (Unused-for-6-months' "Wear it" pins a garment
-- into tomorrow's lucky list), a 'for_you' quota_kind value,
-- public.for_you_cache (server-only, same shape and privileges as
-- rating_cache/lucky_cache — the For you function's result cache) and
-- public.apple_tokens (server-only, one row per user holding the Apple
-- refresh token that account deletion revokes).

-- `alter type ... add value` can't run in the same transaction as a
-- statement that uses the new value. Neither 'donated' nor 'for_you' is
-- referenced anywhere else in this migration (no default, no check, no
-- function body), so both adds commit in the same transaction as the rest
-- of it — the same reasoning 20261108120000_outfits_wears_caches.sql used
-- for 'rating'/'lucky'.
alter type public.garment_status add value 'donated';
alter type public.quota_kind add value 'for_you';

-- public.garments: pinned_on ------------------------------------------------

alter table public.garments add column pinned_on date;

comment on column public.garments.pinned_on is
  'Set by Unused-for-6-months'' "Wear it" to tomorrow''s local date (client-'
  'written, like status). lucky-list includes the garment in that day''s '
  'outfits when any complete outfit with it passes the rules. Never cleared '
  'automatically — the day simply passes.';

-- Same column-grant pattern as status/photo_version: the client already has
-- update revoked outright on this table (see 20261108021700_garments.sql),
-- so this just adds pinned_on to the set of columns granted back.
grant update (pinned_on) on public.garments to authenticated;

-- public.for_you_cache -------------------------------------------------------
-- Server-only, same shape and access rules as rating_cache/lucky_cache: RLS
-- on, no policies at all, revoked from anon and authenticated. Only the
-- For you Edge Function (service_role) ever touches it.

create table public.for_you_cache (
  user_id uuid references auth.users (id) on delete cascade,
  cache_key text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

comment on table public.for_you_cache is
  'Cached For-you results, keyed by (user_id, cache_key). Same shape and '
  'access rules as rating_cache/lucky_cache: server-only, no policies, no '
  'client grants.';

alter table public.for_you_cache enable row level security;

revoke all on public.for_you_cache from anon, authenticated;

-- public.apple_tokens ---------------------------------------------------------
-- Server-only: RLS on, no policies at all, revoked from anon and
-- authenticated. Only the Apple sign-in and account-deletion Edge Functions
-- (service_role) ever touch it.

create table public.apple_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

comment on table public.apple_tokens is
  'One row per user who signed in with Apple, holding the refresh token '
  'account deletion revokes with Apple before removing the auth user. '
  'Server-only: no policies, no client grants.';

alter table public.apple_tokens enable row level security;

revoke all on public.apple_tokens from anon, authenticated;
