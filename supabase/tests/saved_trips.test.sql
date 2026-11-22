-- public.saved_trips (a trip the user saved, with its plan's snapshot): own rows only between two
-- users, no update, no anon access, the shape checks (city, at most 10 days, an object snapshot),
-- a snapshot over 64 KiB, at most 50 trips per user, the cascade on user delete; public.trip_cache is
-- server-only; quota_kind has 'trip'.
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select has_table('public', 'saved_trips', 'public.saved_trips exists');

select has_index('public', 'saved_trips', 'saved_trips_user_id_created_at_idx', 'saved_trips has the list''s index');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, occasion, result) values ('Lisbon', '2026-12-01', '2026-12-10', 'going_out', '{"kind": "ok", "days": []}') $$,
  'A can save a 10-day trip'
);

select is(
  (select user_id from public.saved_trips),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the saved trip belongs to the caller by default'
);

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result) values ('Lisbon', '2026-12-01', '2026-12-11', '{}') $$,
  '23514',
  null,
  'an 11-day trip raises a check_violation'
);

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result) values ('Lisbon', '2026-12-05', '2026-12-04', '{}') $$,
  '23514',
  null,
  'an end before the start raises a check_violation'
);

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result) values ('  ', '2026-12-01', '2026-12-02', '{}') $$,
  '23514',
  null,
  'a blank city raises a check_violation'
);

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result) values ('Lisbon', '2026-12-01', '2026-12-02', '[1]') $$,
  '23514',
  null,
  'a snapshot that is not an object raises a check_violation'
);

select throws_ok(
  $$ insert into public.saved_trips (user_id, city, start_on, end_on, result) values ('22222222-2222-2222-2222-222222222222', 'Lisbon', '2026-12-01', '2026-12-02', '{}') $$,
  '42501',
  null,
  'A cannot save a trip for B'
);

select throws_ok(
  $$ update public.saved_trips set city = 'Porto' $$,
  '42501',
  null,
  'authenticated updating saved_trips raises a privilege error'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.saved_trips), 0, 'B sees none of A''s trips');

with deleted as (
  delete from public.saved_trips returning 1
)
select is((select count(*)::int from deleted), 0, 'B''s delete reaches none of A''s trips');

select throws_ok($$ select count(*) from public.trip_cache $$, '42501', null, 'authenticated cannot read trip_cache');

select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.saved_trips returning 1
)
select is((select count(*)::int from deleted), 1, 'A can delete their own trip');

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result)
     values ('Lisbon', '2026-12-01', '2026-12-02', jsonb_build_object('days', (select jsonb_agg(md5(i::text)) from generate_series(1, 3000) i))) $$,
  '23514',
  null,
  'a snapshot over 64 KiB raises a check_violation'
);

select lives_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result)
     select 'Trip ' || i, '2026-12-01', '2026-12-02', '{}' from generate_series(1, 50) i $$,
  'A can keep 50 saved trips'
);

select throws_ok(
  $$ insert into public.saved_trips (city, start_on, end_on, result) values ('One more', '2026-12-01', '2026-12-02', '{}') $$,
  '23514',
  'saved_trips: at most 50 saved trips per user',
  'the 51st saved trip is refused'
);

-- Another user writing a row for A gets the RLS refusal, never the limit's, so A's count stays private.
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ insert into public.saved_trips (user_id, city, start_on, end_on, result) values ('11111111-1111-1111-1111-111111111111', 'Probe', '2026-12-01', '2026-12-02', '{}') $$,
  '42501',
  null,
  'a row for another user is refused before the limit counts their trips'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok($$ select count(*) from public.saved_trips $$, '42501', null, 'the anon role cannot read saved_trips');

reset role;

select ok('trip' = any(enum_range(null::public.quota_kind)::text[]), 'quota_kind has trip');

-- The cascade on user delete -------------------------------------------------------------------

insert into public.saved_trips (user_id, city, start_on, end_on, result)
values ('22222222-2222-2222-2222-222222222222', 'Bogotá', '2026-12-01', '2026-12-03', '{}');
insert into public.trip_cache (user_id, cache_key, result)
values ('22222222-2222-2222-2222-222222222222', 'k', '{}');

delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.saved_trips where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 saved_trips rows'
);

select is(
  (select count(*)::int from public.trip_cache where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 trip_cache rows'
);

select * from finish();

rollback;
