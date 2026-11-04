-- CHECK constraints on public.profiles: out-of-range measurements, oversized
-- size text, a half-set city coordinate pair, and onboarding completed
-- without a clothing type must all raise check_violation; valid values pass.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ update public.profiles set height_cm = 300 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'height_cm 300 raises a check_violation'
);

select throws_ok(
  $$ update public.profiles set waist_cm = 10 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'waist_cm 10 raises a check_violation'
);

select throws_ok(
  $$ update public.profiles set top_size = '12345678901' where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'an 11-character top_size raises a check_violation'
);

select throws_ok(
  $$ update public.profiles set top_size = '   ' where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'a whitespace-only top_size raises a check_violation'
);

select throws_ok(
  $$ update public.profiles set city_lat = 40.4 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'city_lat without city_lon raises a check_violation'
);

select throws_ok(
  $$ update public.profiles set onboarding_completed_at = now(), clothing_type = null where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514',
  null,
  'onboarding completed with a null clothing_type raises a check_violation'
);

update public.profiles
set
  height_cm = 175,
  chest_cm = 90,
  waist_cm = 80,
  hips_cm = 95,
  top_size = 'M',
  bottom_size = '32',
  shoe_size = '42',
  city_lat = 40.4,
  city_lon = -3.7,
  clothing_type = 'masculine',
  onboarding_completed_at = now()
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select onboarding_completed_at is not null from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'valid values pass every constraint'
);

select * from finish();

rollback;
