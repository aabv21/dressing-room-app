-- Outfit, wear and AI-cache schema for Plan 4 (rating, feeling lucky, Today,
-- Build): `public.outfits`, `public.outfit_items`, `public.wears` (writable
-- only through `public.log_wear()`/`public.save_outfit()`, both security
-- invoker so RLS still gates the direct insert path they fall back to), the
-- `wears_maintain_counts` trigger that keeps `garments.wear_count` and
-- `garments.last_worn_at` in sync, and three server-only AI caches
-- (`rating_cache`, `lucky_cache`, `weather_cache`). Also extends
-- `quota_kind` with the 'rating' and 'lucky' values this plan's quotas use.

-- `alter type ... add value` can't run in the same transaction as a
-- statement that uses the new value, but nothing below references 'rating'
-- or 'lucky' yet (no default, no check, no function body), so both adds and
-- the rest of this migration commit together.
alter type public.quota_kind add value 'rating';
alter type public.quota_kind add value 'lucky';

-- public.outfits ------------------------------------------------------------

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.outfits is
  'One row per rated/worn/saved outfit (a set of garments). Clients never '
  'insert or update directly — public.log_wear() and public.save_outfit() '
  'are the documented path, though RLS also allows a direct insert of the '
  'caller''s own row (security invoker RPCs rely on the caller''s own '
  'grants).';

create index outfits_user_id_idx on public.outfits (user_id);

alter table public.outfits enable row level security;

create policy "outfits_select_own" on public.outfits
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "outfits_insert_own" on public.outfits
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.outfits from anon;

revoke truncate, trigger, references on public.outfits from anon, authenticated;

-- public.outfit_items ---------------------------------------------------------

create table public.outfit_items (
  outfit_id uuid references public.outfits (id) on delete cascade,
  garment_id uuid references public.garments (id) on delete cascade,
  primary key (outfit_id, garment_id)
);

comment on table public.outfit_items is
  'Join rows between an outfit and its garments. No user_id of its own — '
  'policies check the referenced outfit and garment instead.';

create index outfit_items_outfit_id_idx on public.outfit_items (outfit_id);

alter table public.outfit_items enable row level security;

create policy "outfit_items_select_own" on public.outfit_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_id and o.user_id = (select auth.uid())
    )
  );

create policy "outfit_items_insert_own" on public.outfit_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.outfits o
      where o.id = outfit_id and o.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.garments g
      where g.id = garment_id and g.user_id = (select auth.uid())
    )
  );

revoke all on public.outfit_items from anon;

revoke truncate, trigger, references on public.outfit_items from anon, authenticated;

-- An index on user_id doesn't apply here (outfit_items has no user_id of its
-- own); per-user filtering goes through outfit_id, already indexed above.

-- public.wears ----------------------------------------------------------------

create table public.wears (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  worn_on date not null,
  occasion public.occasion,
  score smallint check (score between 0 and 100),
  created_at timestamptz not null default now()
);

comment on table public.wears is
  'One row per logged wear of an outfit. Clients never insert or update '
  'directly — public.log_wear() is the documented path (RLS also allows a '
  'direct insert of the caller''s own row referencing one of their own '
  'outfits). Clients may delete their own rows (Plan 5''s diary undo).';

create index wears_user_id_idx on public.wears (user_id);
create index wears_user_id_worn_on_idx on public.wears (user_id, worn_on desc);

alter table public.wears enable row level security;

create policy "wears_select_own" on public.wears
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "wears_insert_own" on public.wears
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.outfits o
      where o.id = outfit_id and o.user_id = (select auth.uid())
    )
  );

create policy "wears_delete_own" on public.wears
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.wears from anon;

revoke truncate, trigger, references on public.wears from anon, authenticated;

-- No update policy anywhere on wears: a client can never update a wear row,
-- even their own (revoke all above already blocks it at the privilege
-- level; the missing policy is a second, row-level denial).

-- public.maintain_wear_counts() / wears_maintain_counts ----------------------

create function public.maintain_wear_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.garments g
    set wear_count = g.wear_count + 1,
        last_worn_at = greatest(coalesce(g.last_worn_at, new.worn_on::timestamptz), new.worn_on::timestamptz)
    where g.user_id = new.user_id
      and g.id in (
        select oi.garment_id from public.outfit_items oi where oi.outfit_id = new.outfit_id
      );

    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.garments g
    set wear_count = greatest(g.wear_count - 1, 0),
        last_worn_at = (
          select max(w.worn_on)::timestamptz
          from public.wears w
          join public.outfit_items oi on oi.outfit_id = w.outfit_id
          where oi.garment_id = g.id and w.id <> old.id and w.user_id = old.user_id
        )
    where g.user_id = old.user_id
      and g.id in (
        select oi.garment_id from public.outfit_items oi where oi.outfit_id = old.outfit_id
      );

    return old;
  end if;

  return null;
end;
$$;

comment on function public.maintain_wear_counts() is
  'Keeps garments.wear_count/last_worn_at in sync with public.wears. On '
  'insert, every garment in the wear''s outfit gains one wear and its '
  'last_worn_at moves forward to worn_on if later. On delete, every garment '
  'in the deleted wear''s outfit loses one wear (floored at 0) and '
  'last_worn_at is recomputed from that garment''s remaining wears (through '
  'outfit_items), or set to null if none remain. Every update is also '
  'scoped to g.user_id = new/old.user_id, as defense in depth alongside the '
  'wears_insert_own policy''s outfit-ownership check: even if a row ever '
  'reached this trigger referencing another user''s outfit, it could never '
  'touch that user''s garments.';

revoke execute on function public.maintain_wear_counts() from public, anon, authenticated;

create trigger wears_maintain_counts
  after insert or delete on public.wears
  for each row execute function public.maintain_wear_counts();

-- public.log_wear() / public.save_outfit() -----------------------------------

create function public.log_wear(
  p_garment_ids uuid[],
  p_worn_on date,
  p_occasion public.occasion,
  p_score smallint
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outfit_id uuid;
  v_wear_id uuid;
  v_owned_count integer;
begin
  if p_garment_ids is null
     or cardinality(p_garment_ids) < 2
     or cardinality(p_garment_ids) <> (select count(*) from (select distinct unnest(p_garment_ids)) d)
  then
    raise exception using errcode = '22023', message = 'log_wear requires at least 2 distinct garment ids';
  end if;

  select count(*) into v_owned_count
  from public.garments
  where id = any(p_garment_ids);

  if v_owned_count <> cardinality(p_garment_ids) then
    raise exception using errcode = '42501', message = 'log_wear: one or more garments are not the caller''s own';
  end if;

  insert into public.outfits default values returning id into v_outfit_id;

  insert into public.outfit_items (outfit_id, garment_id)
  select v_outfit_id, g from unnest(p_garment_ids) as g;

  insert into public.wears (outfit_id, worn_on, occasion, score)
  values (v_outfit_id, p_worn_on, p_occasion, p_score)
  returning id into v_wear_id;

  return v_wear_id;
end;
$$;

comment on function public.log_wear(uuid[], date, public.occasion, smallint) is
  'Inserts an outfit, its items and a wear, returning the wear id. Raises '
  '22023 for fewer than 2 garment ids or a duplicate, 42501 if any garment '
  'isn''t the caller''s own (checked under the caller''s own RLS, so an '
  'owned count short of the array length means at least one id is either '
  'missing or someone else''s). security invoker: the actual inserts run as '
  'the calling role, gated by outfits/outfit_items/wears'' own insert '
  'policies — the same policies a client''s direct insert would need.';

revoke execute on function public.log_wear(uuid[], date, public.occasion, smallint) from public, anon;
grant execute on function public.log_wear(uuid[], date, public.occasion, smallint) to authenticated;

create function public.save_outfit(p_garment_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outfit_id uuid;
  v_owned_count integer;
begin
  if p_garment_ids is null
     or cardinality(p_garment_ids) < 2
     or cardinality(p_garment_ids) <> (select count(*) from (select distinct unnest(p_garment_ids)) d)
  then
    raise exception using errcode = '22023', message = 'save_outfit requires at least 2 distinct garment ids';
  end if;

  select count(*) into v_owned_count
  from public.garments
  where id = any(p_garment_ids);

  if v_owned_count <> cardinality(p_garment_ids) then
    raise exception using errcode = '42501', message = 'save_outfit: one or more garments are not the caller''s own';
  end if;

  insert into public.outfits (saved_at) values (now()) returning id into v_outfit_id;

  insert into public.outfit_items (outfit_id, garment_id)
  select v_outfit_id, g from unnest(p_garment_ids) as g;

  return v_outfit_id;
end;
$$;

comment on function public.save_outfit(uuid[]) is
  'Inserts an outfit with saved_at = now() and its items, with the same '
  'validation as log_wear(). security invoker, same reasoning.';

revoke execute on function public.save_outfit(uuid[]) from public, anon;
grant execute on function public.save_outfit(uuid[]) to authenticated;

-- public.rating_cache / public.lucky_cache / public.weather_cache -----------
-- Server-only: RLS on, no policies at all, revoke all from anon and
-- authenticated. Only the rating/lucky/weather Edge Functions (service_role)
-- ever touch these.

create table public.rating_cache (
  user_id uuid references auth.users (id) on delete cascade,
  cache_key text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

comment on table public.rating_cache is
  'Cached Jev rating results, keyed by (user_id, cache_key). Server-only: no '
  'policies, no client grants.';

alter table public.rating_cache enable row level security;

revoke all on public.rating_cache from anon, authenticated;

create table public.lucky_cache (
  user_id uuid references auth.users (id) on delete cascade,
  cache_key text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cache_key)
);

comment on table public.lucky_cache is
  'Cached feeling-lucky results, same shape and access rules as '
  'rating_cache.';

alter table public.lucky_cache enable row level security;

revoke all on public.lucky_cache from anon, authenticated;

create table public.weather_cache (
  location_key text not null,
  hour timestamptz not null,
  payload jsonb not null,
  primary key (location_key, hour)
);

comment on table public.weather_cache is
  'Cached Open-Meteo responses, keyed by (location_key, hour). Server-only: '
  'no policies, no client grants. Not user-scoped: weather is shared across '
  'users at the same location and hour.';

alter table public.weather_cache enable row level security;

revoke all on public.weather_cache from anon, authenticated;
