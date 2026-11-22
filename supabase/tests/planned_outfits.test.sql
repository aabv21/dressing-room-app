-- public.planned_outfits and public.plan_outfit(): one plan per user and day, own rows only between
-- two users (select, update, delete), garments that are the caller's own, 2 to 6 distinct ids, a day
-- inside the 14-day window (with a day of slack either side for time zones), no anon access, and the
-- cascade on user delete.
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.garments (id, user_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');

select has_table('public', 'planned_outfits', 'public.planned_outfits exists');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.planned_outfits'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, planned_on)'
  ),
  'one plan per user and day'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select set_config(
  'pgtap.plan_id',
  public.plan_outfit(
    (now() at time zone 'utc')::date + 1,
    array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[],
    'office'
  )::text,
  true
);

select is(
  (select user_id from public.planned_outfits where id = current_setting('pgtap.plan_id')::uuid),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'plan_outfit stores a plan for the caller'
);

select is(
  (select occasion::text from public.planned_outfits where id = current_setting('pgtap.plan_id')::uuid),
  'office',
  'the plan keeps its occasion'
);

select is(
  public.plan_outfit(
    (now() at time zone 'utc')::date + 1,
    array['aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[]
  ),
  current_setting('pgtap.plan_id')::uuid,
  'a second plan for the same day replaces the first (same row)'
);

select is(
  (select garment_ids from public.planned_outfits where id = current_setting('pgtap.plan_id')::uuid),
  array['aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
  'the replaced plan holds the new garments, with no occasion'
);

select is((select count(*)::int from public.planned_outfits), 1, 'still one row for that day');

select throws_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date, array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[]) $$,
  '42501',
  null,
  'plan_outfit refuses another user''s garment'
);

select throws_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date, array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '22023',
  null,
  'plan_outfit refuses a single garment'
);

select throws_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '22023',
  null,
  'plan_outfit refuses a duplicate garment'
);

select throws_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date - 2, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]) $$,
  '22023',
  null,
  'plan_outfit refuses a day in the past'
);

select throws_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date + 15, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]) $$,
  '22023',
  null,
  'plan_outfit refuses a day past the 14-day window'
);

select lives_ok(
  $$ select public.plan_outfit((now() at time zone 'utc')::date + 14, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]) $$,
  'the window''s last day (UTC + 14, local + 13 east of UTC) is accepted'
);

-- The policies check the same rules on a direct write, which never goes through the RPC.
select throws_ok(
  $$ insert into public.planned_outfits (planned_on, garment_ids) values ((now() at time zone 'utc')::date + 3, array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[]) $$,
  '42501',
  null,
  'a direct insert with another user''s garment violates the policy'
);

select throws_ok(
  $$ insert into public.planned_outfits (planned_on, garment_ids) values ((now() at time zone 'utc')::date + 3, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '42501',
  null,
  'a direct insert with a duplicate garment violates the policy'
);

select throws_ok(
  $$ insert into public.planned_outfits (planned_on, garment_ids) values ((now() at time zone 'utc')::date - 5, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]) $$,
  '42501',
  null,
  'a direct insert in the past violates the policy'
);

select throws_ok(
  $$ insert into public.planned_outfits (planned_on, garment_ids) values ((now() at time zone 'utc')::date + 3, array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '23514',
  null,
  'a single garment raises a check_violation'
);

select throws_ok(
  $$ insert into public.planned_outfits (user_id, planned_on, garment_ids) values ('22222222-2222-2222-2222-222222222222', (now() at time zone 'utc')::date + 3, array['bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002']::uuid[]) $$,
  '42501',
  null,
  'A cannot insert a plan for B'
);

select throws_ok(
  format(
    $$ update public.planned_outfits set garment_ids = array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[] where id = %L $$,
    current_setting('pgtap.plan_id')
  ),
  '42501',
  null,
  'an update to another user''s garment violates the policy'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.planned_outfits), 0, 'B sees none of A''s plans');

with updated as (
  update public.planned_outfits set occasion = 'home' returning 1
)
select is((select count(*)::int from updated), 0, 'B''s update reaches none of A''s plans');

with deleted as (
  delete from public.planned_outfits returning 1
)
select is((select count(*)::int from deleted), 0, 'B''s delete reaches none of A''s plans');

select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.planned_outfits where id = current_setting('pgtap.plan_id')::uuid returning 1
)
select is((select count(*)::int from deleted), 1, 'A can delete their own plan');

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok($$ select count(*) from public.planned_outfits $$, '42501', null, 'the anon role cannot read planned_outfits');

select throws_ok(
  $$ select public.plan_outfit(current_date, array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[]) $$,
  '42501',
  null,
  'the anon role cannot call plan_outfit'
);

reset role;

-- The cascade on user delete -------------------------------------------------------------------

insert into public.planned_outfits (user_id, planned_on, garment_ids)
values ('22222222-2222-2222-2222-222222222222', (now() at time zone 'utc')::date, array['bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002']::uuid[]);

delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.planned_outfits where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 planned_outfits rows'
);

select is(
  (select count(*)::int from public.planned_outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'another user''s plans stay'
);

select * from finish();

rollback;
