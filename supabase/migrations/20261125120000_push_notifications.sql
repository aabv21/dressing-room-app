-- Server push notifications (docs/database.md): `public.push_tokens`, written through
-- `register_push_token()` with the phone's device secret or reclaimed through `public.push_claims`,
-- the service-role-only RPCs `claim_review_push()` and `weekly_summary_targets()`, the weekly-summary
-- pg_cron job (pg_net, Vault URL and secret, like the extraction trigger) and the expired claims'
-- cleanup in `prune_expired_caches()`.

-- public.push_tokens ---------------------------------------------------------------------------

create table public.push_tokens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token text not null,
  platform text not null,
  review_ready boolean not null default false,
  weekly boolean not null default false,
  -- Server-only: the 60-minute window between "ready to review" pushes.
  last_review_push_at timestamptz,
  updated_at timestamptz not null default now(),
  -- SHA-256 (hex) of the phone's own random secret: only that phone can register or unregister the token.
  device_secret_hash text not null,
  primary key (user_id, token),
  constraint push_tokens_device_secret_hash_check check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  constraint push_tokens_platform_check check (platform in ('ios', 'android')),
  constraint push_tokens_token_check check (token ~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$' and char_length(token) <= 255)
);

comment on table public.push_tokens is
  'One opted-in phone''s Expo push token per row, with the two notices it wants. Deleted when both '
  'are off, on sign-out, and with the account. Never exported (the preferences are).';

-- The server deletes a dead token and finds a shared token's newest owner by the token alone.
create index push_tokens_token_idx on public.push_tokens (token);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own" on public.push_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "push_tokens_delete_own" on public.push_tokens
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_tokens from anon;
-- Clients write only through register_push_token() (insert and update revoked outright, rather than
-- left to the missing policies), read every column but the secret's hash, and delete their own rows.
revoke select, insert, update, truncate, trigger, references on public.push_tokens from authenticated;
grant select (user_id, token, platform, review_ready, weekly, last_review_push_at, updated_at) on public.push_tokens to authenticated;

-- `updated_at` is the server's registration time (clock_timestamp(), not now(): two registrations
-- in one transaction still order). Only a registration moves it, so a server claim doesn't make a
-- row look newer.
create function public.push_tokens_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.push_tokens_stamp() from public, anon, authenticated;

create trigger push_tokens_stamp
  before insert or update of token, platform, review_ready, weekly on public.push_tokens
  for each row execute function public.push_tokens_stamp();

-- public.register_push_token() -----------------------------------------------------------------

-- A token belongs to one phone, and the phone proves itself with its device secret: another
-- account's row for the token under a different secret refuses the call (someone who only knows the
-- token), while the same secret is that phone with a new account signed in, which takes the token
-- over. The caller's own row may change secret (a reinstall can keep the token but not the secret).
-- A phone that lost its secret (restored app data) reclaims its token by proving it receives the
-- token's pushes (push_claims below).
-- NOTE: whoever holds the unlocked phone holds its secret and its pushes; upgrade: OS-backed device attestation, if the app ever holds data worth that.
create function public.register_push_token(
  p_token text,
  p_platform text,
  p_review_ready boolean,
  p_weekly boolean,
  p_device_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'register_push_token: not signed in';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$' or char_length(p_token) > 255 then
    raise exception using errcode = '22023', message = 'register_push_token: not an Expo push token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception using errcode = '22023', message = 'register_push_token: platform must be ios or android';
  end if;
  -- 32 hex characters is 128 bits; the app sends 64.
  if p_device_secret is null or p_device_secret !~ '^[0-9a-f]{32,128}$' then
    raise exception using errcode = '22023', message = 'register_push_token: the device secret must be 32 to 128 hex characters';
  end if;
  v_hash := encode(extensions.digest(p_device_secret, 'sha256'), 'hex');

  -- Two registrations of one token wait for each other, so both can't pass the check.
  perform pg_advisory_xact_lock(hashtextextended('push_tokens:' || p_token, 0));

  if exists (
    select 1 from public.push_tokens
    where token = p_token and user_id <> v_user and device_secret_hash <> v_hash
  ) then
    raise exception using errcode = '42501', message = 'register_push_token: another device holds this token';
  end if;

  delete from public.push_tokens where token = p_token and user_id <> v_user;

  insert into public.push_tokens (user_id, token, platform, review_ready, weekly, device_secret_hash)
  values (v_user, p_token, p_platform, coalesce(p_review_ready, false), coalesce(p_weekly, false), v_hash)
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        review_ready = excluded.review_ready,
        weekly = excluded.weekly,
        device_secret_hash = excluded.device_secret_hash;
end;
$$;

comment on function public.register_push_token(text, text, boolean, boolean, text) is
  'Stores the caller''s push token with both choices and the SHA-256 of the phone''s secret. 22023 '
  'for a bad token, platform or secret; 42501 when another account holds the token under another '
  'secret. The same secret (that phone, a new account) deletes the other accounts'' rows first.';

revoke execute on function public.register_push_token(text, text, boolean, boolean, text) from public, anon;
grant execute on function public.register_push_token(text, text, boolean, boolean, text) to authenticated;

-- public.push_claims, public.push_claim_starts ------------------------------------------------

-- A reclaim in flight, one per token and account: the push-claim function sent a code to the token
-- as a push; whoever types it back proves the phone receives that token's pushes. Keyed by account
-- too, so one account's claim never blocks another's. Server-only, like the caches.
create table public.push_claims (
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  primary key (token, user_id),
  constraint push_claims_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint push_claims_attempts_check check (attempts between 0 and 5)
);

comment on table public.push_claims is
  'One reclaim per push token and account: the SHA-256 of the code pushed to the token, 10 minutes '
  'and 5 attempts to type it back. No client grants; only push-claim (service role) uses it.';

create index push_claims_user_id_idx on public.push_claims (user_id);

-- Every claim start that sent a code, for the rate limits; kept an hour.
create table public.push_claim_starts (
  id bigint generated always as identity primary key,
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);

comment on table public.push_claim_starts is
  'Claim starts in the last hour, for push-claim''s limits (per token and account, per account, per '
  'token). Server-only; the daily cleanup drops older rows.';

create index push_claim_starts_user_id_started_at_idx on public.push_claim_starts (user_id, started_at);
create index push_claim_starts_token_started_at_idx on public.push_claim_starts (token, started_at);

alter table public.push_claims enable row level security;
alter table public.push_claim_starts enable row level security;

revoke all on public.push_claims from anon, authenticated;
revoke all on public.push_claim_starts from anon, authenticated;

-- Starts (or restarts) the caller's claim on a token some row holds (a token nobody holds simply
-- registers), sending a code at most: once per token and account per 10 minutes, 5 times per
-- account per hour, and 6 times per token per hour.
-- NOTE: the per-token cap is a spam guard, so 6 accounts that know a token can use up its hour; ceiling: they need the token and several accounts (Auth rate-limits sign-ups); upgrade: a per-device quota, if it happens.
create function public.start_push_claim(p_user_id uuid, p_token text, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('push_tokens:' || p_token, 0));
  perform pg_advisory_xact_lock(hashtextextended('push_claims_user:' || p_user_id::text, 0));
  if not exists (select 1 from public.push_tokens where token = p_token) then
    return false;
  end if;
  if exists (
    select 1 from public.push_claim_starts
    where token = p_token and user_id = p_user_id and started_at > now() - interval '10 minutes'
  )
  or (select count(*) from public.push_claim_starts where user_id = p_user_id and started_at > now() - interval '1 hour') >= 5
  or (select count(*) from public.push_claim_starts where token = p_token and started_at > now() - interval '1 hour') >= 6
  then
    return false;
  end if;
  insert into public.push_claims (token, user_id, code_hash, created_at, expires_at)
  values (p_token, p_user_id, p_code_hash, now(), now() + interval '10 minutes')
  on conflict (token, user_id) do update
    set code_hash = excluded.code_hash, created_at = excluded.created_at, expires_at = excluded.expires_at, attempts = 0;
  insert into public.push_claim_starts (token, user_id) values (p_token, p_user_id);
  return true;
end;
$$;

-- Spends one of the claimant's 5 attempts on an unexpired claim and answers the code's hash, which
-- the function compares in constant time; null when there is nothing left to attempt.
create function public.push_claim_attempt(p_user_id uuid, p_token text)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.push_claims
  set attempts = attempts + 1
  where token = p_token and user_id = p_user_id and expires_at > now() and attempts < 5
  returning code_hash;
$$;

-- After a matching code, in one transaction: the caller's claim must still be open; then every claim
-- on the token and its other rows go, and the claimant's row takes the new secret's hash. False when
-- the caller's claim is gone or expired.
create function public.finish_push_claim(
  p_user_id uuid,
  p_token text,
  p_platform text,
  p_review_ready boolean,
  p_weekly boolean,
  p_device_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_platform is null or p_platform not in ('ios', 'android') or p_device_secret is null or p_device_secret !~ '^[0-9a-f]{32,128}$' then
    raise exception using errcode = '22023', message = 'finish_push_claim: bad platform or device secret';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push_tokens:' || p_token, 0));
  delete from public.push_claims where token = p_token and user_id = p_user_id and expires_at > now();
  if not found then
    return false;
  end if;
  -- The token is settled: every other open claim on it goes too.
  delete from public.push_claims where token = p_token;
  delete from public.push_tokens where token = p_token and user_id <> p_user_id;
  insert into public.push_tokens (user_id, token, platform, review_ready, weekly, device_secret_hash)
  values (p_user_id, p_token, p_platform, coalesce(p_review_ready, false), coalesce(p_weekly, false),
          encode(extensions.digest(p_device_secret, 'sha256'), 'hex'))
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        review_ready = excluded.review_ready,
        weekly = excluded.weekly,
        device_secret_hash = excluded.device_secret_hash;
  return true;
end;
$$;

revoke execute on function public.start_push_claim(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.push_claim_attempt(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_push_claim(uuid, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.start_push_claim(uuid, text, text) to service_role;
grant execute on function public.push_claim_attempt(uuid, text) to service_role;
grant execute on function public.finish_push_claim(uuid, text, text, boolean, boolean, text) to service_role;

-- public.claim_review_push() --------------------------------------------------------------------

create function public.claim_review_push(p_user_id uuid)
returns table (token text, language text, ready integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ready integer;
begin
  -- A live extraction (pending, unreviewed, under the app's 10-minute timeout) means the batch
  -- isn't done; an older one already shows in review as failed, so it doesn't hold the notice back.
  if exists (
    select 1 from public.garments g
    where g.user_id = p_user_id and g.status <> 'donated' and g.reviewed_at is null
      and g.extraction_status = 'pending' and g.created_at > now() - interval '10 minutes'
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.garments g
    where g.user_id = p_user_id and g.status <> 'donated' and g.reviewed_at is null and g.extraction_status = 'done'
  ) then
    return;
  end if;

  -- With no live extraction left, every unreviewed active garment is in the review queue.
  select count(*) into v_ready
  from public.garments g
  where g.user_id = p_user_id and g.status <> 'donated' and g.reviewed_at is null;

  -- The update is the claim: a concurrent call waits on the row lock, then sees the new time.
  return query
  with claimed as (
    update public.push_tokens t
    set last_review_push_at = now()
    where t.user_id = p_user_id
      and t.review_ready
      and (t.last_review_push_at is null or t.last_review_push_at <= now() - interval '60 minutes')
      and not exists (
        select 1 from public.push_tokens o
        where o.token = t.token and o.user_id <> t.user_id and o.updated_at > t.updated_at
      )
    returning t.token
  )
  select c.token, coalesce(p.language::text, 'en'), v_ready
  from claimed c
  left join public.profiles p on p.user_id = p_user_id;
end;
$$;

comment on function public.claim_review_push(uuid) is
  'The "ready to review" check for one user: no live extraction, at least one unreviewed done '
  'garment, then claims (sets last_review_push_at on) each review_ready token not pushed in 60 '
  'minutes whose newest holder is this user. Returns those tokens, the profile language and the '
  'review queue''s size. Service role only.';

revoke execute on function public.claim_review_push(uuid) from public, anon, authenticated;
grant execute on function public.claim_review_push(uuid) to service_role;

-- public.weekly_summary_targets() ---------------------------------------------------------------

-- "This week" is the 7 UTC days ending today (the job runs on Sunday). "Unused" is Stats' rule:
-- not donated, added over 182 days ago, never worn or last worn over 182 days ago.
create function public.weekly_summary_targets()
returns table (user_id uuid, token text, language text, outfits integer, unused integer)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'utc')::date as day),
  targets as (
    select
      t.user_id,
      t.token,
      coalesce(p.language::text, 'en') as language,
      (
        select count(*)::int from public.wears w, today
        where w.user_id = t.user_id and w.worn_on between today.day - 6 and today.day
      ) as outfits,
      (
        select count(*)::int from public.garments g, today
        where g.user_id = t.user_id and g.status <> 'donated'
          and (g.created_at at time zone 'utc')::date < today.day - 182
          and (g.last_worn_at is null or (g.last_worn_at at time zone 'utc')::date < today.day - 182)
      ) as unused
    from public.push_tokens t
    left join public.profiles p on p.user_id = t.user_id
    where t.weekly
      and not exists (
        select 1 from public.push_tokens o
        where o.token = t.token and o.user_id <> t.user_id and o.updated_at > t.updated_at
      )
  )
  select user_id, token, language, outfits, unused
  from targets
  where outfits > 0 or unused > 0
  order by user_id, token;
$$;

comment on function public.weekly_summary_targets() is
  'One row per weekly token (its newest holder only) with the outfits logged in the last 7 UTC '
  'days and the active pieces unused for 6 months; users with both at 0 are left out. Service '
  'role only.';

revoke execute on function public.weekly_summary_targets() from public, anon, authenticated;
grant execute on function public.weekly_summary_targets() to service_role;

-- The weekly-summary job ------------------------------------------------------------------------

-- Same shape as request_garment_extraction(): the URL and secret come from the Vault (seeded
-- locally, set by hand on the hosted project), and nothing is sent without them. The warning carries
-- only the SQLSTATE, so neither the URL nor the secret reaches the logs. pg_net stops waiting after
-- 30 s; the function carries on.
create function public.request_weekly_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_summary_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'weekly_summary_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'request_weekly_summary: %', sqlstate;
end;
$$;

alter function public.request_weekly_summary() owner to postgres;

comment on function public.request_weekly_summary() is
  'Posts to the weekly-summary Edge Function with the Vault URL and secret; nothing without them. '
  'Run by the pg_cron job weekly-summary; no client grants.';

revoke execute on function public.request_weekly_summary() from public, anon, authenticated;

select cron.schedule('weekly-summary', '0 13 * * 0', 'select public.request_weekly_summary()');

-- public.prune_expired_caches(): expired push claims -------------------------------------------

-- The other lines are unchanged from 20261122120000_planner_trips.sql.
create or replace function public.prune_expired_caches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rating_cache
  where created_at < now() - interval '30 days'
     or (result -> 'degraded' = 'true'::jsonb and created_at < now() - interval '2 hours');

  delete from public.lucky_cache
  where created_at < now() - interval '30 days'
     or (result -> 'degraded' = 'true'::jsonb and created_at < now() - interval '2 hours');

  delete from public.weather_cache
  where hour < now() - interval '2 days';

  delete from public.for_you_cache f
  where f.created_at < now() - interval '8 days'
    and exists (
      select 1 from public.for_you_cache newer
      where newer.user_id = f.user_id and newer.created_at > f.created_at
    );

  delete from public.trip_cache
  where created_at < now() - interval '7 hours';

  delete from public.planned_outfits
  where planned_on < (now() at time zone 'utc')::date - 30;

  delete from public.push_claims
  where expires_at < now();

  delete from public.push_claim_starts
  where started_at < now() - interval '1 hour';

  delete from cron.job_run_details d
  using cron.job j
  where j.jobid = d.jobid
    and j.jobname = 'prune-expired-caches'
    and d.end_time < now() - interval '30 days';
end;
$$;
