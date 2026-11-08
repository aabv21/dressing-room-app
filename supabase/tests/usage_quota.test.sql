-- public.consume_quota(): increments a per-user, per-day, per-kind counter up
-- to p_limit and refuses further increments; a 0 limit always refuses; a
-- different kind or user is tracked independently; clients can neither call
-- the function nor read public.usage_counters directly.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

set local role service_role;

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 2),
  true,
  'first call under the limit returns true'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 2),
  true,
  'second call reaching the limit returns true'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 2),
  false,
  'third call over the limit returns false'
);

-- A different kind for the same user is independent (still has budget).
select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 2),
  false,
  'the same user and kind stays refused once exhausted'
);

-- A different user is independent: user B has full budget even though A is exhausted.
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'extraction', 2),
  true,
  'a different user is tracked independently'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 0),
  false,
  'p_limit 0 always returns false'
);

reset role;

-- Clients can never call consume_quota directly, even for their own id.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.consume_quota('11111111-1111-1111-1111-111111111111', 'extraction', 2) $$,
  '42501',
  null,
  'authenticated calling consume_quota raises a policy error'
);

-- Clients can never read usage_counters directly either.
select throws_ok(
  $$ select count(*) from public.usage_counters $$,
  '42501',
  null,
  'authenticated selecting usage_counters raises a policy error'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.usage_counters $$,
  '42501',
  null,
  'the anon role cannot read usage_counters'
);

reset role;

select * from finish();

rollback;
