-- public.rating_cache, public.lucky_cache and public.weather_cache are
-- server-only: authenticated and anon can neither select nor insert any of
-- them. `consume_quota` independently tracks the new 'rating' and 'lucky'
-- quota_kind values added for Plan 4 (each returns true up to its limit,
-- then false; one kind being exhausted doesn't affect the other).
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select count(*) from public.rating_cache $$,
  '42501',
  null,
  'authenticated selecting rating_cache raises a policy error'
);

select throws_ok(
  $$ insert into public.rating_cache (user_id, cache_key, result) values ('11111111-1111-1111-1111-111111111111', 'k', '{}'::jsonb) $$,
  '42501',
  null,
  'authenticated inserting rating_cache raises a policy error'
);

select throws_ok(
  $$ select count(*) from public.lucky_cache $$,
  '42501',
  null,
  'authenticated selecting lucky_cache raises a policy error'
);

select throws_ok(
  $$ insert into public.lucky_cache (user_id, cache_key, result) values ('11111111-1111-1111-1111-111111111111', 'k', '{}'::jsonb) $$,
  '42501',
  null,
  'authenticated inserting lucky_cache raises a policy error'
);

select throws_ok(
  $$ select count(*) from public.weather_cache $$,
  '42501',
  null,
  'authenticated selecting weather_cache raises a policy error'
);

select throws_ok(
  $$ insert into public.weather_cache (location_key, hour, payload) values ('loc', now(), '{}'::jsonb) $$,
  '42501',
  null,
  'authenticated inserting weather_cache raises a policy error'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.rating_cache $$,
  '42501',
  null,
  'the anon role cannot read rating_cache'
);

select throws_ok(
  $$ select count(*) from public.lucky_cache $$,
  '42501',
  null,
  'the anon role cannot read lucky_cache'
);

select throws_ok(
  $$ select count(*) from public.weather_cache $$,
  '42501',
  null,
  'the anon role cannot read weather_cache'
);

reset role;

-- 'rating' and 'lucky' are independent quota_kind values: exhausting one
-- doesn't touch the other's budget for the same user.
set local role service_role;

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'rating', 1),
  true,
  'first rating consume_quota call under the limit returns true'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'rating', 1),
  false,
  'second rating consume_quota call over the limit returns false'
);

-- 'lucky' is independent of 'rating': the same user, exhausted for
-- 'rating', still has full budget for 'lucky'.
select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'lucky', 1),
  true,
  'lucky consume_quota is independent of the exhausted rating budget'
);

reset role;

select * from finish();

rollback;
