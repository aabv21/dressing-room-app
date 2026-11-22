-- public.push_tokens (an opted-in phone's Expo push token and its two preferences): written only
-- through register_push_token() with the phone's device secret (a different secret can't register
-- or take over a token; the same secret, a new account on that phone, takes it over), the secret's
-- hash unreadable by clients, own rows only, no anon access, the cascade on user delete; the
-- service-role-only RPCs claim_review_push() (batch done, 60-minute window) and
-- weekly_summary_targets() (this week's wears, pieces unused for 6 months); the weekly-summary
-- pg_cron job and its pg_net call through the Vault.
begin;

create extension if not exists pgtap with schema extensions;

select plan(59);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

update public.profiles set language = 'es' where user_id = '11111111-1111-1111-1111-111111111111';

-- Two phones' device secrets (64 hex characters, as the app makes them).
create temporary table phone (name text primary key, secret text) on commit drop;
insert into phone values ('one', repeat('1a', 32)), ('two', repeat('2b', 32));
grant select on phone to authenticated;

select has_table('public', 'push_tokens', 'public.push_tokens exists');
select has_index('public', 'push_tokens', 'push_tokens_token_idx', 'push_tokens has an index on the token');

-- Grants: no direct client writes but delete; the secret's hash is never readable.
select ok(
  not has_table_privilege('authenticated', 'public.push_tokens', 'INSERT')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'UPDATE')
    and not has_any_column_privilege('authenticated', 'public.push_tokens', 'INSERT')
    and not has_any_column_privilege('authenticated', 'public.push_tokens', 'UPDATE'),
  'authenticated has no insert or update on any push_tokens column'
);
select ok(
  not has_column_privilege('authenticated', 'public.push_tokens', 'device_secret_hash', 'SELECT')
    and has_column_privilege('authenticated', 'public.push_tokens', 'review_ready', 'SELECT')
    and has_table_privilege('authenticated', 'public.push_tokens', 'DELETE'),
  'authenticated can read the preferences and delete, but never read device_secret_hash'
);
select ok(
  not has_table_privilege('anon', 'public.push_tokens', 'SELECT')
    and not has_table_privilege('anon', 'public.push_tokens', 'DELETE'),
  'anon has no access to push_tokens'
);
select ok(
  has_function_privilege('authenticated', 'public.register_push_token(text, text, boolean, boolean, text)', 'execute')
    and not has_function_privilege('anon', 'public.register_push_token(text, text, boolean, boolean, text)', 'execute'),
  'only authenticated can register a token'
);
select is_definer('public', 'register_push_token', array['text', 'text', 'boolean', 'boolean', 'text']::name[], 'register_push_token is security definer');
select ok(
  not has_function_privilege('authenticated', 'public.claim_review_push(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.claim_review_push(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.weekly_summary_targets()', 'execute')
    and not has_function_privilege('anon', 'public.weekly_summary_targets()', 'execute')
    and not has_function_privilege('authenticated', 'public.request_weekly_summary()', 'execute'),
  'clients cannot execute the push RPCs or the cron function'
);
select ok(
  has_function_privilege('service_role', 'public.claim_review_push(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.weekly_summary_targets()', 'execute'),
  'the service role (the Edge Functions) can execute the push RPCs'
);
select hasnt_trigger('public', 'push_tokens', 'push_tokens_take_over', 'no trigger takes a token over without the device secret');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', true, true, (select secret from phone where name = 'one')) $$,
  'A registers phone one''s token'
);
select results_eq(
  $$ select user_id, token, platform, review_ready, weekly from public.push_tokens $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'ExponentPushToken[aaaa]'::text, 'android'::text, true, true) $$,
  'the row is the caller''s, with the choices'
);
select throws_ok(
  $$ select device_secret_hash from public.push_tokens $$,
  '42501', null, 'A cannot read the secret''s hash, even on their own row'
);
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', false, true, (select secret from phone where name = 'one')) $$,
  'registering again from the same phone updates the choices'
);
select is((select review_ready from public.push_tokens), false, 'the choice changed');
select lives_ok(
  $$ select public.register_push_token('ExpoPushToken[bbbb]', 'ios', true, false, (select secret from phone where name = 'one')) $$,
  'the ExpoPushToken[…] form is accepted too'
);
select throws_ok(
  $$ select public.register_push_token('not-a-token', 'android', true, true, (select secret from phone where name = 'one')) $$,
  '22023', null, 'a token in another format is refused'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[cccc]', 'web', true, true, (select secret from phone where name = 'one')) $$,
  '22023', null, 'a platform other than ios or android is refused'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[cccc]', 'android', true, true, 'short') $$,
  '22023', null, 'a device secret under 128 bits is refused'
);
select throws_ok(
  $$ insert into public.push_tokens (token, platform, device_secret_hash) values ('ExponentPushToken[dddd]', 'android', repeat('0', 64)) $$,
  '42501', null, 'A cannot insert a row directly'
);
select throws_ok(
  $$ update public.push_tokens set weekly = false $$,
  '42501', null, 'A cannot update a row directly'
);
select throws_ok(
  $$ select public.claim_review_push('11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'A cannot claim a push'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.push_tokens), 0, 'B sees none of A''s tokens');
with deleted as (
  delete from public.push_tokens returning 1
)
select is((select count(*)::int from deleted), 0, 'B''s delete reaches none of A''s tokens');

-- B knows phone one's token but holds phone two's secret: refused, and A keeps the token.
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', true, true, (select secret from phone where name = 'two')) $$,
  '42501', null, 'another device''s secret cannot register or take over a token'
);
reset role;
select is(
  (select array_agg(user_id::text) from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  array['11111111-1111-1111-1111-111111111111'],
  'A''s row is untouched'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
with deleted as (
  delete from public.push_tokens where token = 'ExpoPushToken[bbbb]' returning 1
)
select is((select count(*)::int from deleted), 1, 'A can delete their own token');

reset role;

-- claim_review_push(): A has one opted-in token (review_ready back on).
update public.push_tokens set review_ready = true where user_id = '11111111-1111-1111-1111-111111111111';

insert into public.garments (id, user_id, extraction_status, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'done', now() - interval '1 minute'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'pending', now() - interval '1 minute');

select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  0,
  'no push while another extraction is still pending'
);

update public.garments set extraction_status = 'failed' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.garments set extraction_status = 'failed' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  0,
  'no push when no unreviewed garment came back done'
);

update public.garments set extraction_status = 'done' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- A pending row past the app's 10-minute timeout and a donated one don't hold the batch back.
insert into public.garments (id, user_id, extraction_status, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'pending', now() - interval '11 minutes');
insert into public.garments (id, user_id, extraction_status, status, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'pending', 'donated', now() - interval '1 minute');

select results_eq(
  $$ select token, language, ready from public.claim_review_push('11111111-1111-1111-1111-111111111111') $$,
  $$ values ('ExponentPushToken[aaaa]'::text, 'es'::text, 3) $$,
  'once the batch is done: the token, the profile language and the review queue''s size'
);

select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  0,
  'a second claim within 60 minutes gets nothing'
);

update public.push_tokens set last_review_push_at = now() - interval '61 minutes';

select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  1,
  'after 60 minutes the next batch can push again'
);

-- B signs in on phone one (same secret): B takes the token over and A's row goes, until A
-- registers it again from that phone.
update public.push_tokens set last_review_push_at = null;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
select public.register_push_token('ExponentPushToken[aaaa]', 'android', true, true, (select secret from phone where name = 'one'));
reset role;

select is(
  (select array_agg(user_id::text) from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  array['22222222-2222-2222-2222-222222222222'],
  'the same phone''s secret takes the token over: the older account''s row is gone'
);
select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  0,
  'so the older account is never pushed on that phone'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
select public.register_push_token('ExponentPushToken[aaaa]', 'android', true, true, (select secret from phone where name = 'one'));
reset role;

select is(
  (select array_agg(user_id::text) from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  array['11111111-1111-1111-1111-111111111111'],
  'A registering it again from that phone takes it back'
);
select is(
  (select count(*)::int from public.claim_review_push('11111111-1111-1111-1111-111111111111')),
  1,
  'and A is pushed again'
);
select is(
  (select device_secret_hash from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  encode(extensions.digest(repeat('1a', 32), 'sha256'), 'hex'),
  'the row keeps the SHA-256 of the secret, never the secret'
);

-- push_claims: B lost nothing but holds phone two; to reclaim A's token B must prove receipt of a
-- push: start (rate limited, only for a held token), attempts (at most 5, unexpired), finish.
select has_table('public', 'push_claims', 'public.push_claims exists');
select ok(
  not has_table_privilege('authenticated', 'public.push_claims', 'SELECT')
    and not has_table_privilege('authenticated', 'public.push_claims', 'INSERT')
    and not has_table_privilege('authenticated', 'public.push_claims', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.push_claims', 'DELETE')
    and not has_table_privilege('anon', 'public.push_claims', 'SELECT')
    and not has_table_privilege('anon', 'public.push_claims', 'INSERT'),
  'clients have no access to push_claims'
);
select ok(
  not has_function_privilege('authenticated', 'public.start_push_claim(uuid, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.push_claim_attempt(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.finish_push_claim(uuid, text, text, boolean, boolean, text)', 'execute')
    and has_function_privilege('service_role', 'public.start_push_claim(uuid, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.push_claim_attempt(uuid, text)', 'execute')
    and has_function_privilege('service_role', 'public.finish_push_claim(uuid, text, text, boolean, boolean, text)', 'execute'),
  'only the service role (push-claim) runs the claim functions'
);
select is(
  public.start_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[nobody]', repeat('c', 64)),
  false,
  'no claim for a token nobody holds (it can simply be registered)'
);
select is(
  public.start_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', encode(extensions.digest('CODE1234', 'sha256'), 'hex')),
  true,
  'B starts a claim on A''s token'
);
select is(
  public.start_push_claim('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaaa]', repeat('d', 64)),
  false,
  'one start per token per 10 minutes, whoever asks'
);
select is(
  public.push_claim_attempt('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaaa]'),
  null,
  'only the claimant can attempt'
);
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]'),
  encode(extensions.digest('CODE1234', 'sha256'), 'hex'),
  'an attempt answers the code''s hash for the function to compare'
);
select public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]') from generate_series(2, 5);
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]'),
  null,
  'the 6th attempt is refused'
);
update public.push_claims set attempts = 0, expires_at = now() - interval '1 second';
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]'),
  null,
  'an expired claim is refused'
);
select is(
  public.finish_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', 'android', true, false, (select secret from phone where name = 'two')),
  false,
  'an expired claim can''t finish either'
);
update public.push_claims set expires_at = now() + interval '5 minutes';
select is(
  public.finish_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', 'android', true, false, (select secret from phone where name = 'two')),
  true,
  'a proven claim finishes'
);
select results_eq(
  $$ select user_id, device_secret_hash = encode(extensions.digest(repeat('2b', 32), 'sha256'), 'hex') from public.push_tokens where token = 'ExponentPushToken[aaaa]' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, true) $$,
  'B now holds the token under phone two''s secret; A''s row is gone'
);
select is((select count(*)::int from public.push_claims), 0, 'the claim is gone');

insert into public.push_claims (token, user_id, code_hash, expires_at) values
  ('ExpoPushToken[old]', '22222222-2222-2222-2222-222222222222', repeat('e', 64), now() - interval '1 minute');
select public.prune_expired_caches();
select is((select count(*)::int from public.push_claims), 0, 'the daily cleanup deletes expired claims');

-- Back to A on phone two (same secret: a takeover), as the weekly section expects.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
select public.register_push_token('ExponentPushToken[aaaa]', 'android', true, true, (select secret from phone where name = 'two'));
reset role;

-- weekly_summary_targets(): A's wears this week and their pieces unused for 6 months.
insert into public.outfits (id, user_id) values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into public.wears (outfit_id, user_id, worn_on) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date - 6),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date - 7);
insert into public.garments (id, user_id, extraction_status, reviewed_at, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'done', now(), now() - interval '200 days'),
  ('aaaaaaaa-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'done', now(), now() - interval '200 days');
insert into public.garments (id, user_id, extraction_status, reviewed_at, status, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'done', now(), 'donated', now() - interval '200 days');
-- Worn recently: the wear trigger keeps last_worn_at, so set it as the server would.
update public.garments set last_worn_at = now() - interval '3 days' where id = 'aaaaaaaa-0000-0000-0000-000000000012';

select results_eq(
  $$ select user_id, token, language, outfits, unused from public.weekly_summary_targets() $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'ExponentPushToken[aaaa]'::text, 'es'::text, 2, 1) $$,
  'the week''s 2 wears (7 days back is last week) and the 1 active piece unused for 6 months'
);

update public.push_tokens set weekly = false;
select is((select count(*)::int from public.weekly_summary_targets()), 0, 'weekly off: no target');

-- A user with nothing to say gets nothing.
update public.push_tokens set weekly = true;
delete from public.wears;
update public.garments set last_worn_at = now() where user_id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.weekly_summary_targets()), 0, 'no wears and nothing unused: no target');

-- The cron job and its pg_net call.
select is(
  (select schedule || ' | ' || command || ' | ' || active::text from cron.job where jobname = 'weekly-summary'),
  '0 13 * * 0 | select public.request_weekly_summary() | true',
  'the weekly-summary job runs on Sundays at 13:00 (pg_cron runs in GMT)'
);

delete from vault.secrets where name in ('weekly_summary_url', 'weekly_summary_secret');
select vault.create_secret('http://example.test/functions/v1/weekly-summary', 'weekly_summary_url');
select vault.create_secret('weekly-test-secret', 'weekly_summary_secret');
select public.request_weekly_summary();

select results_eq(
  $$
    select method::text, headers ->> 'x-webhook-secret'
    from net.http_request_queue
    where url = 'http://example.test/functions/v1/weekly-summary'
  $$,
  $$ values ('POST', 'weekly-test-secret') $$,
  'the job posts once to the Vault URL with the Vault secret'
);

delete from vault.secrets where name in ('weekly_summary_url', 'weekly_summary_secret');
select lives_ok($$ select public.request_weekly_summary() $$, 'without the Vault values the job does nothing and succeeds');

delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*)::int from public.push_tokens where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'deleting the user deletes their tokens'
);

select * from finish();

rollback;
