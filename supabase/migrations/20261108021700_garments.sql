-- Closet schema: garment enums, the `public.garments` table (identity,
-- attributes, extraction/review state, status/photo/wear tracking), its
-- constraints, row level security and column-grant write rules; plus
-- `public.usage_counters` and `public.consume_quota()`, the per-user,
-- per-UTC-day extraction quota gate called only by the extraction function
-- (service_role).

create type public.garment_category as enum (
  -- tops
  't_shirt', 'blouse', 'shirt', 'polo', 'tank_top', 'sweater', 'hoodie', 'cardigan',
  -- bottoms
  'pants', 'jeans', 'shorts', 'skirt', 'leggings',
  -- one-piece
  'dress', 'jumpsuit',
  -- outerwear
  'jacket', 'blazer', 'coat', 'vest',
  -- shoes
  'sneakers', 'shoes', 'heels', 'flats', 'sandals', 'boots', 'loafers',
  'bag', 'hat',
  -- accessories
  'belt', 'scarf', 'tie', 'jewelry', 'sunglasses', 'watch', 'accessory'
);

create type public.garment_color as enum (
  'black', 'white', 'gray', 'navy',
  'blue', 'light_blue', 'red', 'burgundy',
  'pink', 'purple', 'green', 'olive',
  'yellow', 'orange', 'brown', 'camel',
  'beige', 'cream', 'gold', 'silver'
);

create type public.garment_pattern as enum (
  'solid', 'striped', 'checked', 'floral', 'polka_dot', 'animal_print', 'geometric', 'graphic', 'other'
);

create type public.garment_material as enum (
  'cotton', 'denim', 'wool', 'knit', 'leather', 'synthetic', 'silk', 'linen', 'other'
);

create type public.garment_fit as enum ('fitted', 'regular', 'loose', 'oversized');

create type public.season as enum ('spring', 'summer', 'autumn', 'winter');

create type public.garment_status as enum ('available', 'laundry', 'lent');

create type public.extraction_status as enum ('pending', 'done', 'failed', 'over_quota');

create type public.garment_field as enum (
  'category', 'colors', 'pattern', 'material', 'formality', 'seasons', 'warmth', 'fit', 'occasions'
);

create type public.quota_kind as enum ('extraction');

create table public.garments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  category public.garment_category,
  colors public.garment_color[] not null default '{}',
  pattern public.garment_pattern,
  material public.garment_material,
  formality smallint,
  warmth smallint,
  seasons public.season[] not null default '{}',
  fit public.garment_fit,
  occasions public.occasion[] not null default '{}',

  uncertain_fields public.garment_field[] not null default '{}',
  extraction_status public.extraction_status not null default 'pending',
  reviewed_at timestamptz,

  status public.garment_status not null default 'available',
  photo_version smallint not null default 1,
  wear_count integer not null default 0,
  last_worn_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint garments_formality_check check (formality is null or formality between 1 and 5),
  constraint garments_warmth_check check (warmth is null or warmth between 1 and 3),
  constraint garments_colors_check check (cardinality(colors) <= 3),
  constraint garments_photo_version_check check (photo_version >= 1),
  constraint garments_wear_count_check check (wear_count >= 0)
);

comment on table public.garments is
  'One row per closet garment. The client generates id; extraction fields '
  '(extraction_status, uncertain_fields) and wear tracking (wear_count, '
  'last_worn_at, maintained in Plan 4) are server/function-only.';

create index garments_user_id_created_at_idx on public.garments (user_id, created_at desc);

alter table public.garments enable row level security;

create policy "garments_select_own" on public.garments
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "garments_insert_own" on public.garments
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "garments_update_own" on public.garments
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "garments_delete_own" on public.garments
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.garments from anon;

revoke truncate, trigger, references on public.garments from anon, authenticated;

-- The client inserts only `id` (every other column takes its default: the
-- column default supplies user_id, and the table defaults supply the rest).
revoke insert, update on public.garments from authenticated;

grant insert (id) on public.garments to authenticated;

grant update (
  category, colors, pattern, material, formality, seasons, warmth, fit, occasions,
  status, photo_version, reviewed_at
) on public.garments to authenticated;

create trigger garments_set_updated_at
  before update on public.garments
  for each row execute function public.set_updated_at();

create trigger garments_keep_created_at
  before update on public.garments
  for each row execute function public.keep_created_at();

-- Per-user, per-UTC-day, per-kind usage counters. No policies at all: every
-- access goes through public.consume_quota() (security definer), never a
-- direct table read or write from the API.
create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind public.quota_kind not null,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day, kind)
);

alter table public.usage_counters enable row level security;

revoke all on public.usage_counters from anon, authenticated;

create function public.consume_quota(p_user_id uuid, p_kind public.quota_kind, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written boolean;
begin
  if p_limit < 1 then
    return false;
  end if;

  insert into public.usage_counters (user_id, day, kind, count)
  values (p_user_id, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update
    set count = public.usage_counters.count + 1
    where public.usage_counters.count < p_limit
  returning true into v_written;

  return coalesce(v_written, false);
end;
$$;

revoke execute on function public.consume_quota(uuid, public.quota_kind, integer) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, public.quota_kind, integer) to service_role;
