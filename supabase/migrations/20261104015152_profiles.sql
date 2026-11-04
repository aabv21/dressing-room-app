-- Profiles schema: enums, the `public.profiles` table, its constraints, the
-- auth.users signup trigger that creates a profile row, the `updated_at`
-- trigger, and row level security.

create type public.clothing_type as enum ('feminine', 'masculine', 'everything');

create type public.body_type as enum (
  'hourglass',
  'pear',
  'apple',
  'rectangle',
  'inverted_triangle',
  'trapezoid',
  'triangle',
  'oval'
);

create type public.age_group as enum ('under_18', '18_24', '25_34', '35_44', '45_54', '55_plus');

create type public.style as enum (
  'casual',
  'elegant',
  'minimalist',
  'sporty',
  'urban',
  'bohemian',
  'classic'
);

create type public.occasion as enum ('office', 'university', 'going_out', 'home', 'event', 'sport');

create type public.app_language as enum ('en', 'es');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  clothing_type public.clothing_type,
  body_type public.body_type,
  height_cm smallint,
  chest_cm smallint,
  waist_cm smallint,
  hips_cm smallint,
  top_size text,
  bottom_size text,
  shoe_size text,
  age_group public.age_group,
  styles public.style[] not null default '{}',
  occasions public.occasion[] not null default '{}',
  city_name text,
  city_lat double precision,
  city_lon double precision,
  language public.app_language,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_height_cm_check check (height_cm is null or height_cm between 120 and 230),
  constraint profiles_chest_cm_check check (chest_cm is null or chest_cm between 40 and 200),
  constraint profiles_waist_cm_check check (waist_cm is null or waist_cm between 40 and 200),
  constraint profiles_hips_cm_check check (hips_cm is null or hips_cm between 40 and 200),
  constraint profiles_top_size_check check (
    top_size is null or char_length(btrim(top_size)) between 1 and 10
  ),
  constraint profiles_bottom_size_check check (
    bottom_size is null or char_length(btrim(bottom_size)) between 1 and 10
  ),
  constraint profiles_shoe_size_check check (
    shoe_size is null or char_length(btrim(shoe_size)) between 1 and 10
  ),
  constraint profiles_city_lat_check check (city_lat is null or city_lat between -90 and 90),
  constraint profiles_city_lon_check check (city_lon is null or city_lon between -180 and 180),
  constraint profiles_city_lat_lon_pair_check check (
    (city_lat is null) = (city_lon is null)
  ),
  constraint profiles_onboarding_requires_clothing_type_check check (
    onboarding_completed_at is null or clothing_type is not null
  )
);

comment on table public.profiles is 'One profile row per auth.users row, created by handle_new_user().';

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_insert_own" on public.profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No delete policy: account deletion is handled in Plan 5.

revoke truncate, trigger, references on public.profiles from anon, authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
