-- profiles.onboarding_completed_at is stamped with the server clock: a client-sent value is
-- replaced with now() when the column goes from null to non-null (update or insert), and once set
-- it never changes again (a later value or a null keeps the original time).
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-c@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select is(
  (select onboarding_completed_at from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  null,
  'a new profile starts with onboarding not completed'
);

-- User C's row is removed so the insert path below can be exercised through RLS.
delete from public.profiles where user_id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

update public.profiles
set clothing_type = 'feminine', onboarding_completed_at = '2000-01-01T00:00:00Z'
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select onboarding_completed_at from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  now(),
  'completing onboarding stores the server time, not the client-sent value'
);

select set_config('request.jwt.claims', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);

insert into public.profiles (user_id, clothing_type, onboarding_completed_at)
values ('33333333-3333-3333-3333-333333333333', 'masculine', '2000-01-01T00:00:00Z');

select is(
  (select onboarding_completed_at from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'),
  now(),
  'an insert that completes onboarding also stores the server time'
);

-- Give A an earlier completion time than this transaction's now(), bypassing triggers (as the
-- table owner), so "kept" and "re-stamped" are distinguishable below.
reset role;
set local session_replication_role = replica;
update public.profiles
set onboarding_completed_at = '2020-01-01T00:00:00Z'
where user_id = '11111111-1111-1111-1111-111111111111';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

update public.profiles
set onboarding_completed_at = '2100-01-01T00:00:00Z'
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select onboarding_completed_at from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'a second completion keeps the original completion time'
);

update public.profiles
set onboarding_completed_at = null
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select onboarding_completed_at from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'a null never un-completes onboarding'
);

select * from finish();

rollback;
