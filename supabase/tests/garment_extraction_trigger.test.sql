-- public.request_garment_extraction(): the `after insert` trigger on
-- public.garments that asks the extract-attributes Edge Function (via pg_net)
-- to fill in a new garment's attributes. It runs as its owner (security
-- definer) so it can read the Vault, clients can't execute it, and neither a
-- missing Vault secret nor a failing request ever blocks the insert: it just
-- queues no request.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_trigger('public', 'garments', 'garments_request_extraction', 'garments has the extraction trigger');

-- tgtype bits: 1 = for each row, 2 = before, 4 = insert, 8 = delete, 16 = update,
-- 64 = instead of. 1 + 4 = an `after insert ... for each row` trigger only.
select is(
  (
    select tgtype::int
    from pg_trigger
    where tgrelid = 'public.garments'::regclass and tgname = 'garments_request_extraction'
  ),
  5,
  'the trigger fires after insert, for each row, on nothing else'
);

select trigger_is(
  'public', 'garments', 'garments_request_extraction',
  'public', 'request_garment_extraction',
  'the trigger calls public.request_garment_extraction()'
);

select is_definer('public', 'request_garment_extraction', array[]::name[], 'the trigger function is security definer');

select ok(
  not has_function_privilege('authenticated', 'public.request_garment_extraction()', 'execute'),
  'authenticated cannot execute the trigger function'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- With both secrets present, an insert queues exactly one POST carrying the
-- garment id and the webhook secret. Test-only values replace the seeded ones
-- inside this transaction.
delete from vault.secrets where name in ('extract_attributes_url', 'extract_webhook_secret');
select vault.create_secret('http://example.test/functions/v1/extract-attributes', 'extract_attributes_url');
select vault.create_secret('test-secret', 'extract_webhook_secret');

-- Impersonate user A, inserting only `id` as the client does.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into public.garments (id) values ('aaaaaaaa-0000-0000-0000-000000000001');

reset role;

select results_eq(
  $$
    select url, method::text, convert_from(body, 'utf8')::jsonb, headers ->> 'x-webhook-secret', timeout_milliseconds
    from net.http_request_queue
    where url = 'http://example.test/functions/v1/extract-attributes'
  $$,
  $$
    values (
      'http://example.test/functions/v1/extract-attributes',
      'POST',
      '{"garment_id": "aaaaaaaa-0000-0000-0000-000000000001"}'::jsonb,
      'test-secret',
      5000
    )
  $$,
  'an insert queues one POST to the Vault URL with the garment id and the webhook secret'
);

-- Without the secrets (e.g. a hosted project not configured yet), inserts
-- still succeed and nothing more is queued.
delete from vault.secrets where name in ('extract_attributes_url', 'extract_webhook_secret');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ insert into public.garments (id) values ('aaaaaaaa-0000-0000-0000-000000000002') $$,
  'an insert succeeds when the Vault secrets are missing'
);

reset role;

select is(
  (select count(*)::int from net.http_request_queue where convert_from(body, 'utf8') like '%aaaaaaaa-0000-0000-0000-000000000002%'),
  0,
  'no request is queued when the Vault secrets are missing'
);

-- A request that can't be queued (here a Vault URL pg_net rejects; on a hosted
-- project it could be pg_net or Vault misbehaving) must not roll back the
-- insert: extraction is optional, the garment still reaches review.
select vault.create_secret('not a url', 'extract_attributes_url');
select vault.create_secret('test-secret', 'extract_webhook_secret');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ insert into public.garments (id) values ('aaaaaaaa-0000-0000-0000-000000000003') $$,
  'an insert succeeds when queueing the extraction request fails'
);

reset role;

select is(
  (select count(*)::int from public.garments where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  1,
  'the garment row is kept when queueing the extraction request fails'
);

select * from finish();
rollback;
