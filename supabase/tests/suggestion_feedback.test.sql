-- Suggestion feedback and saved outfits: public.dismissed_outfits (own rows only between two users,
-- no update, no anon access, the key's shape check, the cascade on user delete), garments.suggest
-- (default true, client-writable on the caller's own garments only), outfits.score through
-- save_outfit, and deleting a saved outfit (own, saved, never worn; its items cascade; outfit_items
-- itself keeps delete revoked).
begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.garments (id, user_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');

-- public.dismissed_outfits -----------------------------------------------------------------------

select has_table('public', 'dismissed_outfits', 'public.dismissed_outfits exists');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ insert into public.dismissed_outfits (outfit_key) values ('aaaaaaaa-0000-0000-0000-000000000001,aaaaaaaa-0000-0000-0000-000000000002') $$,
  'A can dismiss a combination of their own'
);

select is(
  (select user_id from public.dismissed_outfits),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the dismissed row belongs to the caller by default'
);

select throws_ok(
  $$ insert into public.dismissed_outfits (user_id, outfit_key) values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001,bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'A cannot insert a dismissed row for B'
);

select throws_ok(
  $$ insert into public.dismissed_outfits (outfit_key) values ('not a key') $$,
  '23514',
  null,
  'a key that is not 2 to 6 lowercase uuids joined by commas raises a check_violation'
);

select throws_ok(
  $$ insert into public.dismissed_outfits (outfit_key) values ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '23514',
  null,
  'a single-garment key raises a check_violation'
);

select throws_ok(
  $$ update public.dismissed_outfits set created_at = now() $$,
  '42501',
  null,
  'authenticated updating dismissed_outfits raises a privilege error'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.dismissed_outfits),
  0,
  'B sees none of A''s dismissed rows'
);

with deleted as (
  delete from public.dismissed_outfits returning 1
)
select is(
  (select count(*)::int from deleted),
  0,
  'B''s delete reaches none of A''s dismissed rows'
);

select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.dismissed_outfits),
  1,
  'A''s dismissed row survives B''s delete'
);

select lives_ok(
  $$ insert into public.dismissed_outfits (outfit_key) values ('aaaaaaaa-0000-0000-0000-000000000002,aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing $$,
  'a second dismissal of another key with on conflict do nothing works'
);

with deleted as (
  delete from public.dismissed_outfits
  where outfit_key = 'aaaaaaaa-0000-0000-0000-000000000002,aaaaaaaa-0000-0000-0000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from deleted),
  1,
  'A can delete their own dismissed row'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.dismissed_outfits $$,
  '42501',
  null,
  'the anon role cannot read dismissed_outfits'
);

reset role;

-- public.garments.suggest ------------------------------------------------------------------------

select col_default_is('public', 'garments', 'suggest', 'true', 'garments.suggest defaults to true');

select col_not_null('public', 'garments', 'suggest', 'garments.suggest is not null');

select ok(
  has_column_privilege('authenticated', 'public.garments', 'suggest', 'UPDATE'),
  'authenticated may update garments.suggest'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ update public.garments set suggest = false where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'A can turn suggestions off for their own garment'
);

select is(
  (select suggest from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'the garment''s suggest is stored'
);

with updated as (
  update public.garments set suggest = false where id = 'bbbbbbbb-0000-0000-0000-000000000001' returning 1
)
select is(
  (select count(*)::int from updated),
  0,
  'A''s update of B''s garment''s suggest reaches no row'
);

-- outfits.score and deleting a saved outfit -------------------------------------------------------

select set_config(
  'pgtap.saved_id',
  public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[], 82::smallint)::text,
  true
);

select is(
  (select score from public.outfits where id = current_setting('pgtap.saved_id')::uuid),
  82::smallint,
  'save_outfit stores the score it was given'
);

select set_config(
  'pgtap.unscored_id',
  public.save_outfit(array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[])::text,
  true
);

select is(
  (select score from public.outfits where id = current_setting('pgtap.unscored_id')::uuid),
  null::smallint,
  'save_outfit without a score leaves it null (older builds still call it this way)'
);

select set_config(
  'pgtap.worn_wear_id',
  public.log_wear(gen_random_uuid(), array['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']::uuid[], current_date)::text,
  true
);

with deleted as (
  delete from public.outfits
  where id = (select outfit_id from public.wears where id = current_setting('pgtap.worn_wear_id')::uuid)
  returning 1
)
select is(
  (select count(*)::int from deleted),
  0,
  'a worn outfit (never saved) cannot be deleted'
);

select throws_ok(
  format($$ delete from public.outfit_items where outfit_id = %L $$, current_setting('pgtap.saved_id')),
  '42501',
  null,
  'deleting outfit_items directly still raises a privilege error'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.outfits where id = current_setting('pgtap.saved_id')::uuid returning 1
)
select is(
  (select count(*)::int from deleted),
  0,
  'B cannot delete A''s saved outfit'
);

select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.outfits where id = current_setting('pgtap.saved_id')::uuid returning 1
)
select is(
  (select count(*)::int from deleted),
  1,
  'A can delete their own saved outfit'
);

select is(
  (select count(*)::int from public.outfit_items where outfit_id = current_setting('pgtap.saved_id')::uuid),
  0,
  'the deleted outfit''s items cascade away'
);

reset role;

-- A saved outfit a wear points at (only a direct insert, never the app's path) keeps its row, so
-- the cascade can never drop a wear without lowering its counts.
insert into public.wears (user_id, outfit_id, worn_on)
values ('11111111-1111-1111-1111-111111111111', current_setting('pgtap.unscored_id')::uuid, current_date);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

with deleted as (
  delete from public.outfits where id = current_setting('pgtap.unscored_id')::uuid returning 1
)
select is(
  (select count(*)::int from deleted),
  0,
  'a saved outfit with a wear cannot be deleted'
);

reset role;

select has_index('public', 'outfits', 'outfits_user_id_saved_at_idx', 'outfits has the Saved list''s partial index');

-- The cascade on user delete --------------------------------------------------------------------

insert into public.dismissed_outfits (user_id, outfit_key)
values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001,bbbbbbbb-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.dismissed_outfits where user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'B has a dismissed row before the delete'
);

delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.dismissed_outfits where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 dismissed_outfits rows'
);

select is(
  (select count(*)::int from public.dismissed_outfits where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'another user''s dismissed rows stay'
);

select * from finish();

rollback;
