-- Columns a client may not set on public.profiles: created_at keeps the time the signup trigger
-- created the row, whatever an update sends.
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Give the row a creation time distinguishable from this transaction's now().
set local session_replication_role = replica;
update public.profiles set created_at = '2020-01-01T00:00:00Z' where user_id = '11111111-1111-1111-1111-111111111111';
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

update public.profiles
set created_at = '2100-01-01T00:00:00Z', city_name = 'Bogotá'
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select created_at from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'a client update cannot change created_at'
);

select is(
  (select city_name from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  'Bogotá',
  'the rest of that update still applies'
);

select * from finish();

rollback;
