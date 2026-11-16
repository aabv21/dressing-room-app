-- public.keep_alive(): the daily keep-alive workflow calls it with the anon key so a free project
-- isn't paused after a week without users. Anon can call it, it answers the server time, and it
-- reads no table (a SQL function over `now()` only).
begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  has_function_privilege('anon', 'public.keep_alive()', 'execute'),
  'anon can execute public.keep_alive()'
);

set local role anon;

select ok(
  abs(extract(epoch from (public.keep_alive() - now()))) < 1,
  'keep_alive answers the server time to anon'
);

reset role;

select is(
  (select prosrc from pg_proc where oid = 'public.keep_alive()'::regprocedure),
  ' select now() ',
  'keep_alive reads no table'
);

select * from finish();
rollback;
