-- Row level security on storage.objects for the `garments` bucket, plus the
-- bucket's own configuration (private, 2 MiB limit, three MIME types).
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select is(
  (select public from storage.buckets where id = 'garments'),
  false,
  'the garments bucket is private'
);

select is(
  (select file_size_limit from storage.buckets where id = 'garments'),
  2097152::bigint,
  'the garments bucket has a 2 MiB file size limit'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'garments'),
  array['image/webp', 'image/png', 'image/jpeg'],
  'the garments bucket allows exactly the three image MIME types'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- B's object is created as postgres (bypassing RLS) before A is impersonated,
-- so "A can't see B's object" is a real assertion, not vacuously true because
-- the object never existed.
insert into storage.objects (bucket_id, name, owner)
values ('garments', '22222222-2222-2222-2222-222222222222/b.webp', '22222222-2222-2222-2222-222222222222');

-- Impersonate user A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into storage.objects (bucket_id, name, owner)
values ('garments', '11111111-1111-1111-1111-111111111111/x.webp', '11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from storage.objects where name = '11111111-1111-1111-1111-111111111111/x.webp'),
  1,
  'user A can insert into their own folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner) values ('garments', '22222222-2222-2222-2222-222222222222/x.webp', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  null,
  'user A cannot insert into user B''s folder'
);

select is(
  (select count(*)::int from storage.objects where name = '22222222-2222-2222-2222-222222222222/b.webp'),
  0,
  'user A selecting user B''s existing object returns 0 rows'
);

-- A's update targeting B's object affects 0 rows: RLS silently filters the
-- target out, so the statement succeeds but touches nothing.
select lives_ok(
  $$ update storage.objects set name = '22222222-2222-2222-2222-222222222222/renamed.webp' where name like '22222222-2222-2222-2222-222222222222/%' $$,
  'user A updating user B''s object does not raise'
);

select throws_ok(
  $$ update storage.objects set name = '22222222-2222-2222-2222-222222222222/x.webp' where name = '11111111-1111-1111-1111-111111111111/x.webp' $$,
  '42501',
  null,
  'user A renaming their own object into user B''s folder raises a policy error'
);

-- Check the actual effect as postgres, which bypasses RLS: B's object name
-- is unchanged, and it still exists.
reset role;

select is(
  (select count(*)::int from storage.objects where name = '22222222-2222-2222-2222-222222222222/b.webp'),
  1,
  'user B''s object name is unchanged and still exists'
);

select * from finish();

rollback;
