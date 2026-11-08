-- Plan 5 schema: the 'donated' garment_status value and garments.pinned_on
-- (client-writable, same column-grant pattern as status/photo_version), the
-- 'for_you' quota_kind value, public.for_you_cache (server-only, same shape
-- and privileges as rating_cache/lucky_cache) and public.apple_tokens
-- (server-only, one row per user holding the Apple refresh token for account
-- deletion's revoke step). Also the cascade assertion every public table with
-- a user_id must satisfy: an FK to auth.users with ON DELETE CASCADE
-- (pg_constraint.confdeltype = 'c'), and that deleting a user actually empties
-- every one of those tables.
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.garments (id, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- The client can set its own pinned_on and status = 'donated'.
select lives_ok(
  $$ update public.garments set pinned_on = current_date + 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'the client can set pinned_on on their own garment'
);

select is(
  (select pinned_on from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (current_date + 1),
  'pinned_on was stored as the client''s date'
);

select lives_ok(
  $$ update public.garments set status = 'donated' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'the client can set status to donated on their own garment'
);

select is(
  (select status from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'donated'::public.garment_status,
  'status was stored as donated'
);

-- The client can't select or insert apple_tokens or for_you_cache.
select throws_ok(
  $$ select count(*) from public.apple_tokens $$,
  '42501',
  null,
  'authenticated selecting apple_tokens raises a policy error'
);

select throws_ok(
  $$ insert into public.apple_tokens (user_id, refresh_token) values ('11111111-1111-1111-1111-111111111111', 'tok') $$,
  '42501',
  null,
  'authenticated inserting apple_tokens raises a policy error'
);

select throws_ok(
  $$ select count(*) from public.for_you_cache $$,
  '42501',
  null,
  'authenticated selecting for_you_cache raises a policy error'
);

select throws_ok(
  $$ insert into public.for_you_cache (user_id, cache_key, result) values ('11111111-1111-1111-1111-111111111111', 'k', '{}'::jsonb) $$,
  '42501',
  null,
  'authenticated inserting for_you_cache raises a policy error'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.apple_tokens $$,
  '42501',
  null,
  'the anon role cannot read apple_tokens'
);

select throws_ok(
  $$ insert into public.apple_tokens (user_id, refresh_token) values ('11111111-1111-1111-1111-111111111111', 'tok') $$,
  '42501',
  null,
  'the anon role cannot insert apple_tokens'
);

select throws_ok(
  $$ select count(*) from public.for_you_cache $$,
  '42501',
  null,
  'the anon role cannot read for_you_cache'
);

select throws_ok(
  $$ insert into public.for_you_cache (user_id, cache_key, result) values ('11111111-1111-1111-1111-111111111111', 'k', '{}'::jsonb) $$,
  '42501',
  null,
  'the anon role cannot insert for_you_cache'
);

reset role;

-- The 'for_you' quota_kind is tracked independently, same as 'rating'/'lucky'.
set local role service_role;

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'for_you', 1),
  true,
  'first for_you consume_quota call under the limit returns true'
);

select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'for_you', 1),
  false,
  'second for_you consume_quota call over the limit returns false'
);

reset role;

-- The cascade assertion: every public table with a user_id column has an FK
-- to auth.users with ON DELETE CASCADE (confdeltype = 'c'). Checked generically
-- against pg_constraint so it covers exactly the tables the brief names,
-- rather than repeating one hand-written assertion per table.
-- Aggregated into a plain text[] with array_agg (not pgTAP's results_eq,
-- whose refcursor-diffing path hits "could not determine which collation to
-- use" comparing pg_class.relname's name type against a text[] literal) and
-- compared with is(), sidestepping that collation ambiguity entirely.
select is(
  (
    select coalesce(array_agg(rel.relname::text order by rel.relname), array[]::text[])
    from pg_attribute att
    join pg_class rel on rel.oid = att.attrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relkind = 'r'
      and att.attname = 'user_id'
      and att.attnum > 0
      and not att.attisdropped
      and not exists (
        select 1
        from pg_constraint con
        join pg_class frel on frel.oid = con.confrelid
        join pg_namespace fnsp on fnsp.oid = frel.relnamespace
        where con.contype = 'f'
          and con.conrelid = rel.oid
          and fnsp.nspname = 'auth'
          and frel.relname = 'users'
          and con.confdeltype = 'c'
      )
  ),
  array[]::text[],
  'every public table with a user_id column has an ON DELETE CASCADE FK to auth.users'
);

-- Pin this to the exact table list the brief names, so a future table that
-- drops its user_id column (or renames it) can't silently shrink this set
-- without the test file changing too.
select is(
  (
    select array_agg(rel.relname::text order by rel.relname)
    from pg_attribute att
    join pg_class rel on rel.oid = att.attrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relkind = 'r'
      and att.attname = 'user_id'
      and att.attnum > 0
      and not att.attisdropped
  ),
  array['apple_tokens', 'for_you_cache', 'garments', 'lucky_cache', 'outfits', 'profiles', 'rating_cache', 'usage_counters', 'wears']::text[],
  'the set of public tables with a user_id column matches the brief''s list'
);

-- Deleting a user with garments, wears and caches leaves 0 rows for that user
-- everywhere user_id appears. Build a full fixture as postgres (bypassing
-- RLS) for user B so this is a real assertion, not vacuously true.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.garments (id, user_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

insert into public.outfits (id, user_id)
values ('bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

insert into public.outfit_items (outfit_id, garment_id)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001');

insert into public.wears (id, user_id, outfit_id, worn_on)
values ('bbbbbbbb-2222-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-0000-0000-000000000001', current_date);

insert into public.usage_counters (user_id, day, kind, count)
values ('22222222-2222-2222-2222-222222222222', current_date, 'extraction', 1);

insert into public.rating_cache (user_id, cache_key, result)
values ('22222222-2222-2222-2222-222222222222', 'k', '{}'::jsonb);

insert into public.lucky_cache (user_id, cache_key, result)
values ('22222222-2222-2222-2222-222222222222', 'k', '{}'::jsonb);

insert into public.for_you_cache (user_id, cache_key, result)
values ('22222222-2222-2222-2222-222222222222', 'k', '{}'::jsonb);

insert into public.apple_tokens (user_id, refresh_token)
values ('22222222-2222-2222-2222-222222222222', 'tok');

delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 profiles rows'
);

select is(
  (select count(*)::int from public.garments where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 garments rows'
);

select is(
  (select count(*)::int from public.outfits where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 outfits rows'
);

select is(
  (select count(*)::int from public.wears where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 wears rows'
);

select is(
  (select count(*)::int from public.usage_counters where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 usage_counters rows'
);

select is(
  (select count(*)::int from public.rating_cache where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 rating_cache rows'
);

select is(
  (select count(*)::int from public.lucky_cache where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 lucky_cache rows'
);

select is(
  (select count(*)::int from public.for_you_cache where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 for_you_cache rows'
);

select is(
  (select count(*)::int from public.apple_tokens where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user leaves 0 apple_tokens rows'
);

select * from finish();

rollback;
