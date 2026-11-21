-- garments.price and garments.currency: nullable, client-writable on the caller's own garments only,
-- a non-negative price with two decimals, an ISO 4217-shaped code, and never one without the other.
begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.garments (id, user_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

select col_type_is('public', 'garments', 'price', 'numeric(10,2)', 'garments.price is numeric(10,2)');
select col_is_null('public', 'garments', 'price', 'garments.price is nullable');
select col_type_is('public', 'garments', 'currency', 'text', 'garments.currency is text');
select col_is_null('public', 'garments', 'currency', 'garments.currency is nullable');

select ok(
  has_column_privilege('authenticated', 'public.garments', 'price', 'UPDATE')
    and has_column_privilege('authenticated', 'public.garments', 'currency', 'UPDATE'),
  'authenticated may update garments.price and garments.currency'
);

select ok(
  not has_column_privilege('anon', 'public.garments', 'price', 'UPDATE')
    and not has_column_privilege('anon', 'public.garments', 'currency', 'UPDATE'),
  'anon may not update garments.price or garments.currency'
);

select is(
  (select price from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null::numeric,
  'a new garment has no price'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ update public.garments set price = 49.90, currency = 'USD' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'A can price their own garment'
);

select results_eq(
  $$ select price, currency from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (49.90::numeric(10,2), 'USD'::text) $$,
  'the price and currency are stored'
);

select lives_ok(
  $$ update public.garments set price = 250000.456, currency = 'COP' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'a price with more decimals is accepted'
);

select is(
  (select price from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  250000.46::numeric,
  'and rounded to two decimals'
);

select lives_ok(
  $$ update public.garments set price = null, currency = null where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'A can clear the price and currency together'
);

with updated as (
  update public.garments set price = 10, currency = 'USD' where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning 1
)
select is(
  (select count(*)::int from updated),
  0,
  'A''s update of B''s garment''s price reaches no row'
);

select throws_ok(
  $$ update public.garments set price = -1, currency = 'USD' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a negative price raises a check_violation'
);

select throws_ok(
  $$ update public.garments set price = 10, currency = 'usd' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a lower-case currency raises a check_violation'
);

select throws_ok(
  $$ update public.garments set price = 10, currency = 'US' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a two-letter currency raises a check_violation'
);

select throws_ok(
  $$ update public.garments set price = 10 where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a price without a currency raises a check_violation'
);

select throws_ok(
  $$ update public.garments set currency = 'USD' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a currency without a price raises a check_violation'
);

reset role;

select * from finish();

rollback;
