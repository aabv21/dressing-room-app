-- public.log_wear() and public.save_outfit(): happy path (one outfit, its
-- items and a wear; wear_count/last_worn_at maintained on insert and delete),
-- idempotency on p_wear_id, cross-user rejection (42501), validation
-- (22023 for too few items or a duplicate), cross-user isolation on
-- outfits/outfit_items/wears (including a real outfit_items assertion, not
-- a vacuous one hidden by the outfits join), save_outfit stamping saved_at
-- and never touching wears/counts, no client update anywhere (now a real
-- 42501, not a silently-filtered no-op), wear deletion (B can't delete A's
-- wear; A's own delete as authenticated decrements counts), a garment
-- delete cascading its outfit_items rows, and the cross-tenant
-- direct-insert paths a security review flagged: a wear naming another
-- user's outfit_id, and an outfit_item naming another user's outfit or
-- garment, must all be denied (and must never reach the wear-count
-- trigger).
begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

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

-- log_wear with 3 of A's garments: one outfit, 3 items, one wear, with a
-- client-generated wear id (dddddddd-...-0001).
select is(
  public.log_wear(
    'dddddddd-0000-0000-0000-000000000001'::uuid,
    array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
    '2026-11-01'::date, 'office'::public.occasion, 80::smallint
  ),
  'dddddddd-0000-0000-0000-000000000001'::uuid,
  'log_wear for A with 3 garments returns the caller-supplied wear id'
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

-- Calling log_wear again with the same wear id is idempotent: it returns
-- the same id and logs nothing new (a retry after a lost response must
-- never double-log).
select is(
  public.log_wear(
    'dddddddd-0000-0000-0000-000000000001'::uuid,
    array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
    '2026-11-01'::date, 'office'::public.occasion, 80::smallint
  ),
  'dddddddd-0000-0000-0000-000000000001'::uuid,
  'calling log_wear again with the same wear id returns the same id'
);

select is(
  (select count(*)::int from public.wears where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the retried call logged no additional wear'
);

select is(
  (select count(*)::int from public.outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the retried call created no additional outfit'
);

-- Stash A's outfit id so B's direct cross-tenant insert attempts below can
-- target a real outfit, not a made-up uuid that would never match anyway.
select set_config(
  'pgtap.a_outfit_id',
  (select outfit_id::text from public.outfit_items oi join public.outfits o on o.id = oi.outfit_id where o.user_id = '11111111-1111-1111-1111-111111111111' limit 1),
  true
);

reset role;

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'garment 1 wear_count is 1 after the first wear (the retry did not double it)'
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

-- A second log_wear reusing 2 of the 3 garments plus a later date, a
-- different wear id.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(
  public.log_wear(
    'dddddddd-0000-0000-0000-000000000002'::uuid,
    array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[],
    '2026-11-05'::date, 'going_out'::public.occasion, 60::smallint
  ),
  'dddddddd-0000-0000-0000-000000000002'::uuid,
  'second log_wear for A with 2 garments returns the second wear id'
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

-- Deleting the second wear restores counts and last_worn_at. Delete it as
-- A, through authenticated (not postgres): this both exercises
-- wears_delete_own as the real client path and proves the security
-- definer trigger fires correctly for a client-issued delete, not just one
-- run as the table owner.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- A data-modifying WITH must be the top-level statement, so the delete and
-- the is() assertion are combined into one statement rather than nesting
-- the delete inside a scalar subquery passed to is().
with deleted as (
  delete from public.wears where id = 'dddddddd-0000-0000-0000-000000000002'::uuid returning id
)
select is(
  (select count(*)::int from deleted),
  1,
  'A deleting their own wear as authenticated removes exactly one row'
);

reset role;

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'garment 1 wear_count is back to 1 after A''s own delete (authenticated) of the second wear'
);

select is(
  (select last_worn_at::date from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2026-11-01'::date,
  'garment 1 last_worn_at is restored to the remaining wear''s date'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1,
  'garment 2 wear_count is back to 1 after A''s own delete (authenticated) of the second wear'
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
       'dddddddd-0000-0000-0000-000000000003'::uuid,
       array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[],
       '2026-11-02'::date, null, null
     ) $$,
  '42501',
  null,
  'log_wear by B referencing A''s garment raises a policy error'
);

-- Security-review fix: B inserting a wear directly, claiming their own
-- user_id but A's outfit_id, must still be rejected — wears_insert_own also
-- requires the outfit to be the caller's own, not just user_id = auth.uid().
select throws_ok(
  format(
    $$ insert into public.wears (user_id, outfit_id, worn_on) values ('22222222-2222-2222-2222-222222222222', %L, '2026-11-02') $$,
    current_setting('pgtap.a_outfit_id')::uuid
  ),
  '42501',
  null,
  'B inserting a wear with A''s outfit_id raises a policy error'
);

-- A's garment counts must be unaffected by B's rejected attempt above.
-- Check as postgres (bypassing RLS): B can't even see A's garment, so this
-- read has to run as a role that isn't filtered by garments_select_own.
reset role;

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'A''s garment 1 wear_count is unchanged after B''s rejected cross-tenant wear insert'
);

-- B deleting A's wear directly: wears_delete_own filters by user_id, so the
-- delete reaches no row (B doesn't own it) and A's wear/counts survive.
select is(
  (select count(*)::int from public.wears where id = 'dddddddd-0000-0000-0000-000000000001'::uuid),
  1,
  'A''s wear still exists before B''s delete attempt'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.wears where id = 'dddddddd-0000-0000-0000-000000000001'::uuid returning id
)
select is(
  (select count(*)::int from deleted),
  0,
  'B deleting A''s wear by id removes 0 rows'
);

reset role;

select is(
  (select count(*)::int from public.wears where id = 'dddddddd-0000-0000-0000-000000000001'::uuid),
  1,
  'A''s wear still exists after B''s rejected delete attempt'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'A''s garment 1 wear_count is unchanged after B''s rejected cross-tenant wear delete'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

-- B inserting an outfit_item into A's outfit (even with B's own garment) is
-- rejected — outfit_items_insert_own requires the outfit to be the
-- caller's, regardless of whose garment is named.
select throws_ok(
  format(
    $$ insert into public.outfit_items (outfit_id, garment_id) values (%L, 'bbbbbbbb-0000-0000-0000-000000000001') $$,
    current_setting('pgtap.a_outfit_id')::uuid
  ),
  '42501',
  null,
  'B inserting an outfit_item into A''s outfit raises a policy error'
);

-- B inserting an outfit_item naming A's garment (even into B's own outfit)
-- is also rejected — outfit_items_insert_own requires the garment to be
-- the caller's too. Give B their own outfit row directly (as postgres,
-- bypassing RLS — this is fixture setup, not the thing under test).
reset role;

insert into public.outfits (id, user_id)
values ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ insert into public.outfit_items (outfit_id, garment_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'B inserting an outfit_item naming A''s garment raises a policy error'
);

-- B selecting user A's outfit_items by outfit_id or by garment_id returns 0
-- rows. This asserts the real outfit_items_select_own ownership check
-- directly, rather than joining through outfits first (a join that would
-- pass even with a vacuous `using (true)` policy, since the join's own
-- "o.user_id = A" condition is what filters out B's view either way).
select is(
  (select count(*)::int from public.outfit_items where outfit_id = current_setting('pgtap.a_outfit_id')::uuid),
  0,
  'B selecting outfit_items by A''s outfit_id returns 0 rows'
);

select is(
  (select count(*)::int from public.outfit_items where garment_id = 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
  0,
  'B selecting outfit_items by A''s garment_id returns 0 rows'
);

-- Back to impersonating A for the rest of the file.
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- A single garment (fewer than 2) is rejected.
select throws_ok(
  $$ select public.log_wear(
       'dddddddd-0000-0000-0000-000000000004'::uuid,
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
       'dddddddd-0000-0000-0000-000000000005'::uuid,
       array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
       '2026-11-02'::date, null, null
     ) $$,
  '22023',
  null,
  'log_wear with a duplicate garment id raises an invalid-parameter error'
);

-- A single garment (fewer than 2) is rejected on save_outfit too.
select throws_ok(
  $$ select public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '22023',
  null,
  'save_outfit with a single garment raises an invalid-parameter error'
);

-- A duplicate garment id is rejected on save_outfit too.
select throws_ok(
  $$ select public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[]) $$,
  '22023',
  null,
  'save_outfit with a duplicate garment id raises an invalid-parameter error'
);

-- save_outfit by A referencing B's garment is rejected.
select throws_ok(
  $$ select public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']::uuid[]) $$,
  '42501',
  null,
  'save_outfit by A referencing B''s garment raises a policy error'
);

-- save_outfit stamps saved_at, and creates no wear or count change. Call it
-- in its own statement and stash the id in a GUC: a single statement takes
-- one snapshot for all its scans, so a later scan in the *same* statement
-- (even inside a CTE) never sees a row a volatile function call earlier in
-- that statement just inserted.
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

select is(
  (select count(*)::int from public.wears where outfit_id = current_setting('pgtap.save_outfit_id')::uuid),
  0,
  'save_outfit creates no wears row'
);

select is(
  (select wear_count from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'save_outfit does not change garment 1''s wear_count'
);

-- B selecting A's outfits and wears returns 0 rows.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B selecting user A''s outfits returns 0 rows'
);

select is(
  (select count(*)::int from public.wears where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'user B selecting user A''s wears returns 0 rows'
);

-- No client update anywhere: update is revoked outright at the table-grant
-- level on outfits, outfit_items and wears (not left to a missing policy,
-- which would only silently filter to 0 rows instead of raising).
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ update public.wears set score = 1 where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  null,
  'authenticated updating wears raises a policy error'
);

select throws_ok(
  format($$ update public.outfits set saved_at = now() where id = %L $$, current_setting('pgtap.a_outfit_id')::uuid),
  '42501',
  null,
  'authenticated updating outfits raises a policy error'
);

select throws_ok(
  format($$ update public.outfit_items set garment_id = garment_id where outfit_id = %L $$, current_setting('pgtap.a_outfit_id')::uuid),
  '42501',
  null,
  'authenticated updating outfit_items raises a policy error'
);

-- No client delete on outfits or outfit_items either (delete is revoked
-- outright, same as update).
select throws_ok(
  format($$ delete from public.outfits where id = %L $$, current_setting('pgtap.a_outfit_id')::uuid),
  '42501',
  null,
  'authenticated deleting outfits raises a policy error'
);

select throws_ok(
  format($$ delete from public.outfit_items where outfit_id = %L $$, current_setting('pgtap.a_outfit_id')::uuid),
  '42501',
  null,
  'authenticated deleting outfit_items raises a policy error'
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
