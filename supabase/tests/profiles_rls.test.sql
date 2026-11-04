-- Row level security on public.profiles: each user sees and can only
-- select/insert/update their own row; no cross-user access; anon sees none.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- Two users, created directly in auth.users so the signup trigger fires and
-- creates their profile rows.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select is(
  (select count(*)::int from public.profiles where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')),
  2,
  'the signup trigger created a profile row for both users'
);

-- Impersonate user A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.profiles),
  1,
  'user A sees only one row through RLS'
);

select is(
  (select user_id from public.profiles limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the one row user A sees is their own'
);

-- A's update targeting B's row affects 0 rows: RLS silently filters the
-- target out, so the statement succeeds but touches nothing.
select lives_ok(
  $$ update public.profiles set city_name = 'Nowhere' where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A updating user B''s row does not raise'
);

-- Check the actual effect as postgres, which bypasses RLS.
reset role;

select is(
  (select city_name from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
  null::text,
  'user A''s update did not change user B''s row'
);

-- Back to impersonating user A for the remaining assertions.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- A cannot insert a row for B — B already has a profile from the trigger, so
-- exercise the policy directly against a row that is not A's.
select throws_ok(
  $$ insert into public.profiles (user_id) values ('33333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'user A inserting a row for someone else raises a policy error'
);

-- Anonymous role sees zero rows.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select is(
  (select count(*)::int from public.profiles),
  0,
  'the anon role sees zero profile rows'
);

select * from finish();

rollback;
