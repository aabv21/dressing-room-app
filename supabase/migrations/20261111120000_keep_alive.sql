-- A no-op the daily keep-alive workflow (.github/workflows/keepalive.yml) calls with the anon key:
-- Supabase pauses a free project after 7 days without activity, and a family app can go a week
-- unused. It reads nothing and answers the server time, so exposing it to anon exposes no data.
create function public.keep_alive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon;
