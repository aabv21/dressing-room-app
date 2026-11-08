-- CHECK constraints and column-grant write rules on public.garments: out-of-range
-- formality/warmth/colors/photo_version all raise check_violation; a client can
-- insert only `id` (user_id, status and extraction_status are then set by the
-- defaults, not the client) and can never write extraction_status, wear_count
-- or user_id; created_at is kept and updated_at moves on update.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- Inserting with id only succeeds; user_id, status and extraction_status come
-- from their defaults, not the client.
insert into public.garments (id) values ('cccccccc-0000-0000-0000-000000000001');

select is(
  (select user_id from public.garments where id = 'cccccccc-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'inserting with id only sets user_id to the caller'
);

select is(
  (select status from public.garments where id = 'cccccccc-0000-0000-0000-000000000001'),
  'available'::public.garment_status,
  'inserting with id only sets status to available'
);

select is(
  (select extraction_status from public.garments where id = 'cccccccc-0000-0000-0000-000000000001'),
  'pending'::public.extraction_status,
  'inserting with id only sets extraction_status to pending'
);

select throws_ok(
  $$ update public.garments set formality = 6 where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'formality 6 raises a check_violation'
);

select throws_ok(
  $$ update public.garments set warmth = 0 where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'warmth 0 raises a check_violation'
);

select throws_ok(
  $$ update public.garments set colors = array['black', 'white', 'gray', 'navy']::public.garment_color[] where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  '4 colors raises a check_violation'
);

select throws_ok(
  $$ update public.garments set photo_version = 0 where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'photo_version 0 raises a check_violation'
);

-- The client can never write extraction_status, wear_count or user_id, even
-- on their own row.
select throws_ok(
  $$ update public.garments set extraction_status = 'done' where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'updating extraction_status raises a policy error'
);

select throws_ok(
  $$ update public.garments set wear_count = 5 where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'updating wear_count raises a policy error'
);

select throws_ok(
  $$ update public.garments set user_id = '22222222-2222-2222-2222-222222222222' where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'updating user_id raises a policy error'
);

-- Give the row a creation time distinguishable from this transaction's now(),
-- the same technique profiles_write_rules.test.sql uses.
reset role;
set local session_replication_role = replica;
update public.garments set created_at = '2020-01-01T00:00:00Z', updated_at = '2020-01-01T00:00:00Z'
where id = 'cccccccc-0000-0000-0000-000000000001';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

update public.garments set status = 'laundry' where id = 'cccccccc-0000-0000-0000-000000000001';

select is(
  (select created_at from public.garments where id = 'cccccccc-0000-0000-0000-000000000001'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'an update leaves created_at unchanged'
);

select isnt(
  (select updated_at from public.garments where id = 'cccccccc-0000-0000-0000-000000000001'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'an update moves updated_at'
);

select * from finish();

rollback;
