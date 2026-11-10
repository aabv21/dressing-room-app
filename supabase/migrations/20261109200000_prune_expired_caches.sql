-- A daily cleanup of the server-only caches, which otherwise only grow: a new day, occasion,
-- closet edit or profile save writes new keys, and `weather_cache` gains a row per place and hour.
--
-- Each cache's lifetime comes from the Edge Functions (`_shared/userContext.ts`'s `cacheFresh`
-- and each handler):
--   * `rating_cache`, `lucky_cache`: a result marked `degraded: true` is a hit for 1 hour, so it
--     goes after 2 (the hour plus a margin: the functions write `created_at` with their own clock).
--     Any other result never expires in code; it goes after 30 days, and a later request for the
--     same key simply recomputes it.
--   * `weather_cache`: read only for the current UTC hour; an hour over 2 days old goes.
--   * `for_you_cache`: a hit for 7 days. A spent quota serves the same key's expired entry, else
--     the user's newest entry under any key, so each user's newest row stays whatever its age; an
--     older row (left by a failed best-effort prune) goes after 8 days (the week plus a day).
--   * `cron.job_run_details`: pg_cron never deletes run history, so this job's own goes after 30
--     days.
--
-- pg_cron is created in `pg_catalog` (its objects live in the `cron` schema), as Supabase's Cron
-- docs show. Scheduling under an existing job name replaces that job, so re-running this file
-- keeps a single job. pg_cron's schedule is in GMT (`cron.timezone`).

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create function public.prune_expired_caches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rating_cache
  where created_at < now() - interval '30 days'
     or (result -> 'degraded' = 'true'::jsonb and created_at < now() - interval '2 hours');

  delete from public.lucky_cache
  where created_at < now() - interval '30 days'
     or (result -> 'degraded' = 'true'::jsonb and created_at < now() - interval '2 hours');

  delete from public.weather_cache
  where hour < now() - interval '2 days';

  delete from public.for_you_cache f
  where f.created_at < now() - interval '8 days'
    and exists (
      select 1 from public.for_you_cache newer
      where newer.user_id = f.user_id and newer.created_at > f.created_at
    );

  delete from cron.job_run_details d
  using cron.job j
  where j.jobid = d.jobid
    and j.jobname = 'prune-expired-caches'
    and d.end_time < now() - interval '30 days';
end;
$$;

alter function public.prune_expired_caches() owner to postgres;

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime, keeping each user''s newest For you entry. '
  'Run daily by the pg_cron job prune-expired-caches; no client grants.';

revoke execute on function public.prune_expired_caches() from public, anon, authenticated;

select cron.schedule('prune-expired-caches', '0 4 * * *', 'select public.prune_expired_caches()');
