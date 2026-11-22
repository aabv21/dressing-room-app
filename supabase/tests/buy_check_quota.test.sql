-- The 'buy_check' quota kind ("Should I buy it?"): five checks a day on the caller's local day, the
-- sixth refused, counted apart from the other kinds and from another user.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select ok('buy_check' = any(enum_range(null::public.quota_kind)::text[]), 'quota_kind has buy_check');

set local role service_role;

select is(
  (select bool_and(public.consume_quota('11111111-1111-1111-1111-111111111111', 'buy_check', 5, (now() at time zone 'utc')::date + 1)) from generate_series(1, 5)),
  true,
  'five buy checks on the local day are allowed'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'buy_check', 5, (now() at time zone 'utc')::date + 1),
  false,
  'the sixth buy check on the same local day is refused'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 100),
  true,
  'extraction is independent of the exhausted buy_check budget'
);

select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'buy_check', 5, (now() at time zone 'utc')::date + 1),
  true,
  'another user has their own buy_check budget'
);

reset role;

select is(
  (select count from public.usage_counters where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'buy_check'),
  5,
  'the counter stops at the limit'
);

select * from finish();
rollback;
