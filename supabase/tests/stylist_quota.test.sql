-- The 'stylist' quota kind ("Ask your stylist"): twenty messages a day on the caller's local day,
-- the 21st refused, counted apart from the other kinds and from another user.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select ok('stylist' = any(enum_range(null::public.quota_kind)::text[]), 'quota_kind has stylist');

set local role service_role;

select is(
  (select bool_and(public.consume_quota('11111111-1111-1111-1111-111111111111', 'stylist', 20, (now() at time zone 'utc')::date + 1)) from generate_series(1, 20)),
  true,
  'twenty stylist messages on the local day are allowed'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'stylist', 20, (now() at time zone 'utc')::date + 1),
  false,
  'the 21st stylist message on the same local day is refused'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'buy_check', 5, (now() at time zone 'utc')::date + 1),
  true,
  'buy_check is independent of the exhausted stylist budget'
);

select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'stylist', 20, (now() at time zone 'utc')::date + 1),
  true,
  'another user has their own stylist budget'
);

reset role;

select is(
  (select count from public.usage_counters where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'stylist'),
  20,
  'the counter stops at the limit'
);

select * from finish();
rollback;
