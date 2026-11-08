-- public.log_wear() and public.save_outfit(): happy path (one outfit, its
-- items and a wear; wear_count/last_worn_at maintained on insert and delete),
-- cross-user rejection (42501), validation (22023 for too few items or a
-- duplicate), cross-user isolation on outfits/outfit_items/wears, save_outfit
-- stamping saved_at, no client update on wears, and a garment delete
-- cascading its outfit_items rows.
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- A's garments, created as postgres (bypassing RLS).
insert into public.garments (id, user_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

-- B's own garment, to prove B can log wears for themselves independently.
insert into public.garments (id, user_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- Impersonate A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- log_wear with 3 of A's garments: one outfit, 3 items, one wear.
select ok(
  public.log_wear(
    array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
    '2026-11-01'::date, 'office'::public.occasion, 80::smallint
  ) is not null,
  'log_wear for A with 3 garments returns a wear id'
);

select is(
  (select count(*)::int from public.wears where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'exactly one wear row was created'
);

select is(
  (select count(*)::int from public.outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'exactly one outfit row was created'
);

select is(
  (select count(*)::int from public.outfit_items oi join public.outfits o on o.id = oi.outfit_id where o.user_id = '11111111-1111-1111-1111-111111111111'),
  3,
  'exactly 3 outfit_items rows were created'
);

reset role;

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'garment 1 wear_count is 1 after the first wear'
);

select is(
  (select last_worn_at::date from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2026-11-01'::date,
  'garment 1 last_worn_at matches worn_on after the first wear'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  1,
  'garment 3 wear_count is 1 after the first wear'
);

-- A second log_wear reusing 2 of the 3 garments plus a later date.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select ok(
  (select public.log_wear(
     array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[],
     '2026-11-05'::date, 'going_out'::public.occasion, 60::smallint
   )) is not null,
  'second log_wear for A with 2 garments returns a wear id'
);

reset role;

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2,
  'garment 1 wear_count is 2 after the second wear'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  2,
  'garment 2 wear_count is 2 after the second wear'
);

select is(
  (select last_worn_at::date from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2026-11-05'::date,
  'garment 1 last_worn_at moved to the later wear date'
);

-- Deleting the second wear restores counts and last_worn_at.
delete from public.wears
where user_id = '11111111-1111-1111-1111-111111111111' and worn_on = '2026-11-05';

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'garment 1 wear_count is back to 1 after deleting the second wear'
);

select is(
  (select last_worn_at::date from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2026-11-01'::date,
  'garment 1 last_worn_at is restored to the remaining wear''s date'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1,
  'garment 2 wear_count is back to 1 after deleting the second wear'
);

-- Garment 2 is also in the first wear (2026-11-01), so after deleting the
-- second wear its last_worn_at falls back to that remaining wear's date,
-- not null.
select is(
  (select last_worn_at::date from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '2026-11-01'::date,
  'garment 2 last_worn_at falls back to its remaining wear''s date'
);

-- B logging a wear with A's garment is rejected.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.log_wear(
       array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[],
       '2026-11-02'::date, null, null
     ) $$,
  '42501',
  null,
  'log_wear by B referencing A''s garment raises a policy error'
);

-- A single garment (fewer than 2) is rejected.
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.log_wear(
       array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
       '2026-11-02'::date, null, null
     ) $$,
  '22023',
  null,
  'log_wear with a single garment raises an invalid-parameter error'
);

-- A duplicate garment id is rejected.
select throws_ok(
  $$ select public.log_wear(
       array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
       '2026-11-02'::date, null, null
     ) $$,
  '22023',
  null,
  'log_wear with a duplicate garment id raises an invalid-parameter error'
);

-- save_outfit stamps saved_at. Call it in its own statement and stash the
-- id in a GUC: a single statement takes one snapshot for all its scans, so
-- a later scan in the *same* statement (even inside a CTE) never sees a row
-- a volatile function call earlier in that statement just inserted.
select set_config(
  'pgtap.save_outfit_id',
  public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[])::text,
  true
);

select ok(
  (select saved_at from public.outfits where id = current_setting('pgtap.save_outfit_id')::uuid) is not null,
  'save_outfit sets saved_at on the created outfit'
);

reset role;

-- B selecting A's outfits, items and wears returns 0 rows.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B selecting user A''s outfits returns 0 rows'
);

select is(
  (select count(*)::int
     from public.outfit_items oi
     join public.outfits o on o.id = oi.outfit_id
    where o.user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B selecting user A''s outfit_items returns 0 rows'
);

select is(
  (select count(*)::int from public.wears where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B selecting user A''s wears returns 0 rows'
);

-- No client update on wears, even the owner's own row: there is no update
-- policy, so RLS silently filters the target out — the statement succeeds
-- but touches nothing (same "missing policy is a denial" pattern as
-- garments_rls.test.sql's cross-user update).
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ update public.wears set score = 1 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'authenticated updating wears does not raise'
);

select is(
  (select count(*)::int from public.wears where user_id = '11111111-1111-1111-1111-111111111111' and score = 1),
  0,
  'authenticated updating wears changes no row'
);

reset role;

-- Deleting the first (and now only) wear containing garment 3 drops its
-- last_worn_at to null, since no wear remains for it.
delete from public.wears
where user_id = '11111111-1111-1111-1111-111111111111' and worn_on = '2026-11-01';

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0,
  'garment 3 wear_count is back to 0 after deleting its only wear'
);

select is(
  (select last_worn_at from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  null,
  'garment 3 last_worn_at is null once it has no remaining wears'
);

-- Deleting a garment cascades its outfit_items rows.
delete from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.outfit_items where garment_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0,
  'deleting a garment cascades its outfit_items rows'
);

select * from finish();

rollback;
