-- public.prune_expired_caches() and its daily pg_cron job: rows past each cache's lifetime (plus a
-- margin) go; fresh rows, and For you rows a spent quota can still serve as stale, stay. The job is
-- scheduled once, daily at 04:00 UTC, and no client role can call the function.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- rating_cache and lucky_cache: a result never expires in code, so a row goes after 30 days; a
-- degraded one is served for 1 hour, so it goes after 2 (the hour plus a margin for clock skew
-- between the functions, which write `created_at`, and the database).
insert into public.rating_cache (user_id, cache_key, result, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'fresh', '{"score": 80, "degraded": false}', now() - interval '29 days'),
  ('11111111-1111-1111-1111-111111111111', 'old', '{"score": 80, "degraded": false}', now() - interval '31 days'),
  ('11111111-1111-1111-1111-111111111111', 'degraded-fresh', '{"score": 60, "degraded": true}', now() - interval '90 minutes'),
  ('11111111-1111-1111-1111-111111111111', 'degraded-old', '{"score": 60, "degraded": true}', now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111', 'unmarked', '[1, 2]', now() - interval '3 hours');

insert into public.lucky_cache (user_id, cache_key, result, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'fresh', '{"kind": "ok", "degraded": false}', now() - interval '29 days'),
  ('11111111-1111-1111-1111-111111111111', 'old', '{"kind": "ok", "degraded": false}', now() - interval '31 days'),
  ('11111111-1111-1111-1111-111111111111', 'degraded-fresh', '{"kind": "ok", "degraded": true}', now() - interval '90 minutes'),
  ('11111111-1111-1111-1111-111111111111', 'degraded-old', '{"kind": "ok", "degraded": true}', now() - interval '3 hours');

-- weather_cache is only read for the current UTC hour.
insert into public.weather_cache (location_key, hour, payload) values
  ('fresh', date_trunc('hour', now()) - interval '1 day', '{}'),
  ('old', date_trunc('hour', now()) - interval '3 days', '{}');

-- for_you_cache: an entry is a hit for 7 days. A spent quota serves the same key's expired entry,
-- else the user's newest entry under any key, so each user's newest row stays whatever its age.
insert into public.for_you_cache (user_id, cache_key, result, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'only-and-old', '{"kind": "ok", "degraded": false}', now() - interval '20 days'),
  ('22222222-2222-2222-2222-222222222222', 'newest', '{"kind": "ok", "degraded": false}', now() - interval '1 day'),
  ('22222222-2222-2222-2222-222222222222', 'within-ttl', '{"kind": "ok", "degraded": true}', now() - interval '5 days'),
  ('22222222-2222-2222-2222-222222222222', 'expired', '{"kind": "ok", "degraded": false}', now() - interval '10 days');

-- The job's own run history: kept for 30 days. (`runid` is given: only pg_cron itself may draw from
-- its sequence.)
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select jobid, 900001, 1, 'postgres', 'postgres', command, 'succeeded', 'old', now() - interval '31 days', now() - interval '31 days'
from cron.job where jobname = 'prune-expired-caches'
union all
select jobid, 900002, 1, 'postgres', 'postgres', command, 'succeeded', 'recent', now() - interval '1 day', now() - interval '1 day'
from cron.job where jobname = 'prune-expired-caches';

select lives_ok($$ select public.prune_expired_caches() $$, 'postgres can run the cleanup');

select is(
  array(select cache_key from public.rating_cache order by 1),
  array['degraded-fresh', 'fresh', 'unmarked'],
  'rating_cache keeps fresh rows and drops rows over 30 days and degraded rows over 2 hours'
);

select is(
  array(select cache_key from public.lucky_cache order by 1),
  array['degraded-fresh', 'fresh'],
  'lucky_cache keeps fresh rows and drops rows over 30 days and degraded rows over 2 hours'
);

select is(
  array(select location_key from public.weather_cache order by 1),
  array['fresh'],
  'weather_cache drops hours over 2 days old'
);

select is(
  array(select user_id::text || '/' || cache_key from public.for_you_cache order by 1),
  array[
    '11111111-1111-1111-1111-111111111111/only-and-old',
    '22222222-2222-2222-2222-222222222222/newest',
    '22222222-2222-2222-2222-222222222222/within-ttl'
  ],
  'for_you_cache drops expired rows but keeps each user''s newest row, which a spent quota serves'
);

select is(
  array(
    select d.return_message from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'prune-expired-caches'
    order by 1
  ),
  array['recent'],
  'the job''s run history over 30 days old goes'
);

select lives_ok($$ select public.prune_expired_caches() $$, 'a second run with nothing to delete still succeeds');

-- The schedule.
select is(
  (select count(*)::int from cron.job where jobname = 'prune-expired-caches'),
  1,
  'one cleanup job is scheduled'
);

select is(
  (select schedule || ' | ' || command || ' | ' || active::text from cron.job where jobname = 'prune-expired-caches'),
  '0 4 * * * | select public.prune_expired_caches() | true',
  'the job runs the cleanup daily at 04:00 (pg_cron runs in GMT)'
);

-- Scheduling under the same name again (a re-run migration) replaces the job instead of adding one.
select cron.schedule('prune-expired-caches', '0 4 * * *', 'select public.prune_expired_caches()');

select is(
  (select count(*)::int from cron.job where jobname = 'prune-expired-caches'),
  1,
  'scheduling the job again keeps a single job'
);

-- The function's privileges.
select is(
  (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.prune_expired_caches()'::regprocedure),
  true,
  'the function is security definer, owned by postgres, with an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.prune_expired_caches()', 'execute'),
  'anon cannot execute the cleanup'
);

select ok(
  not has_function_privilege('authenticated', 'public.prune_expired_caches()', 'execute'),
  'authenticated cannot execute the cleanup'
);

select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.prune_expired_caches()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'public has no execute grant on the cleanup'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.prune_expired_caches() $$,
  '42501',
  null,
  'an authenticated call is refused'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.prune_expired_caches() $$,
  '42501',
  null,
  'an anon call is refused'
);

select * from finish();

rollback;
