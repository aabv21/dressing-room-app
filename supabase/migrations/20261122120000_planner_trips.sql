-- The outfit planner and trip packing (docs/database.md): `public.planned_outfits` with
-- `plan_outfit()`, `public.saved_trips`, the server-only `public.trip_cache`, the 'trip' quota
-- kind, and `prune_expired_caches()` with trip_cache's lifetime.

-- Nothing below uses the new value, so it commits with the rest (see 20261108120000).
alter type public.quota_kind add value 'trip';

-- public.planned_outfits -----------------------------------------------------------------------

create table public.planned_outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  planned_on date not null,
  -- No foreign key is possible on an array: a deleted garment's id stays, and the app wears only
  -- the pieces still there.
  garment_ids uuid[] not null,
  occasion public.occasion,
  created_at timestamptz not null default now(),
  constraint planned_outfits_user_id_planned_on_key unique (user_id, planned_on),
  constraint planned_outfits_garment_ids_check check (cardinality(garment_ids) between 2 and 6)
);

comment on table public.planned_outfits is
  'One outfit the user planned for a day (at most one per day, 14 days ahead). Not a wear: Today '
  'logs one only on "I''ll wear it". The unique key leads with user_id, so it serves the per-user '
  'reads by day.';

alter table public.planned_outfits enable row level security;

-- Shared by the insert and update policies: the caller's own distinct garments, on a day inside the
-- window. The UTC date plus a day of slack either side covers every time zone (UTC-12 to UTC+14);
-- the app holds its own local day to the exact 14 days.
create function public.planned_outfit_allowed(p_planned_on date, p_garment_ids uuid[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_planned_on between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 14
    and cardinality(p_garment_ids) = (select count(distinct g) from unnest(p_garment_ids) as g)
    and cardinality(p_garment_ids) = (
      select count(*) from public.garments
      where id = any(p_garment_ids) and user_id = (select auth.uid())
    );
$$;

comment on function public.planned_outfit_allowed(date, uuid[]) is
  'The planned_outfits write rule: a day from the UTC date - 1 to + 14, and distinct garments that '
  'are all the caller''s own. security invoker: it reads garments under the caller''s RLS.';

revoke execute on function public.planned_outfit_allowed(date, uuid[]) from public, anon;
grant execute on function public.planned_outfit_allowed(date, uuid[]) to authenticated;

create policy "planned_outfits_select_own" on public.planned_outfits
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "planned_outfits_insert_own" on public.planned_outfits
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and public.planned_outfit_allowed(planned_on, garment_ids));

create policy "planned_outfits_update_own" on public.planned_outfits
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.planned_outfit_allowed(planned_on, garment_ids));

create policy "planned_outfits_delete_own" on public.planned_outfits
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.planned_outfits from anon;
revoke truncate, trigger, references on public.planned_outfits from authenticated;

create function public.plan_outfit(p_planned_on date, p_garment_ids uuid[], p_occasion public.occasion default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_utc_day date := (now() at time zone 'utc')::date;
  v_owned_count integer;
  v_id uuid;
begin
  if p_garment_ids is null
     or cardinality(p_garment_ids) not between 2 and 6
     or cardinality(p_garment_ids) <> (select count(*) from (select distinct unnest(p_garment_ids)) d)
  then
    raise exception using errcode = '22023', message = 'plan_outfit requires 2 to 6 distinct garment ids';
  end if;

  if p_planned_on is null or p_planned_on not between v_utc_day - 1 and v_utc_day + 14 then
    raise exception using errcode = '22023', message = 'plan_outfit: the day is outside the 14-day window';
  end if;

  select count(*) into v_owned_count
  from public.garments
  where id = any(p_garment_ids);

  if v_owned_count <> cardinality(p_garment_ids) then
    raise exception using errcode = '42501', message = 'plan_outfit: one or more garments are not the caller''s own';
  end if;

  insert into public.planned_outfits (planned_on, garment_ids, occasion)
  values (p_planned_on, p_garment_ids, p_occasion)
  on conflict (user_id, planned_on) do update
    set garment_ids = excluded.garment_ids, occasion = excluded.occasion, created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.plan_outfit(date, uuid[], public.occasion) is
  'Plans an outfit for a day, replacing that day''s plan, and returns its id. 22023 for fewer than '
  '2, more than 6 or duplicate ids, or a day outside the UTC date - 1 to + 14; 42501 for a garment '
  'that isn''t the caller''s own. security invoker, so the table''s policies gate the write too.';

revoke execute on function public.plan_outfit(date, uuid[], public.occasion) from public, anon;
grant execute on function public.plan_outfit(date, uuid[], public.occasion) to authenticated;

-- public.saved_trips ---------------------------------------------------------------------------

create table public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  city text not null,
  start_on date not null,
  end_on date not null,
  occasion public.occasion,
  -- The trip-plan answer as shown when saved; the app re-validates it on read.
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint saved_trips_city_check check (char_length(btrim(city)) between 1 and 100),
  constraint saved_trips_dates_check check (end_on >= start_on and end_on - start_on <= 9),
  constraint saved_trips_result_check check (jsonb_typeof(result) = 'object')
);

comment on table public.saved_trips is
  'A trip the user saved from "Pack for a trip", with the plan''s snapshot. Nothing is stored '
  'unless the user saves it.';

create index saved_trips_user_id_created_at_idx on public.saved_trips (user_id, created_at desc);

alter table public.saved_trips enable row level security;

create policy "saved_trips_select_own" on public.saved_trips
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "saved_trips_insert_own" on public.saved_trips
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "saved_trips_delete_own" on public.saved_trips
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.saved_trips from anon;

-- A saved trip is kept or deleted, never edited: update is revoked rather than left to a missing
-- policy, which would match zero rows instead of raising.
revoke update, truncate, trigger, references on public.saved_trips from authenticated;

-- public.trip_cache ----------------------------------------------------------------------------

create table public.trip_cache (
  user_id uuid references auth.users (id) on delete cascade,
  cache_key text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

comment on table public.trip_cache is
  'Cached trip-plan answers (6 hours), same shape and access rules as rating_cache.';

alter table public.trip_cache enable row level security;

revoke all on public.trip_cache from anon, authenticated;

-- public.prune_expired_caches(): trip_cache's line -----------------------------------------------

-- The other lines are unchanged from 20261109200000_prune_expired_caches.sql. trip_cache answers
-- are a hit for 6 hours (`TRIP_TTL_MS`), so a row goes after 7 (the margin for the functions' clock).
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

  delete from cron.job_run_details d
  using cron.job j
  where j.jobid = d.jobid
    and j.jobname = 'prune-expired-caches'
    and d.end_time < now() - interval '30 days';
end;
$$;

revoke execute on function public.prune_expired_caches() from public, anon, authenticated;
