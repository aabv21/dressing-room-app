-- Row level security on public.garments: each user sees and can only insert,
-- update and delete their own rows; no cross-user access; anon has no access
-- at all.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- A's garment, created as postgres (bypassing RLS) so "B can't see it" below
-- is a real assertion, not vacuously true because the row never existed.
insert into public.garments (id, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

-- Impersonate user B.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'user B selecting user A''s garment returns 0 rows'
);

-- B's update/delete targeting A's row affect 0 rows: RLS silently filters the
-- target out, so the statement succeeds but touches nothing.
select lives_ok(
  $$ update public.garments set status = 'laundry' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'user B updating user A''s garment does not raise'
);

select lives_ok(
  $$ delete from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'user B deleting user A''s garment does not raise'
);

-- Check the actual effect as postgres, which bypasses RLS: A's row is
-- unchanged and still exists.
reset role;

select is(
  (select status from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'available'::public.garment_status,
  'user B''s update did not change user A''s garment'
);

-- Back to impersonating user B.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ insert into public.garments (id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  null,
  'user B inserting a row claiming user A as owner raises a policy error'
);

-- The anon role has no privileges on garments at all.
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.garments $$,
  '42501',
  null,
  'the anon role cannot read garments'
);

reset role;

select * from finish();

rollback;
