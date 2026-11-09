-- Schema-wide rules from docs/database.md's "New table checklist", checked generically so a future
-- table or function that misses one fails here instead of passing unnoticed:
--   * no trigger function in `public` is directly executable by a client role.
begin;

create extension if not exists pgtap with schema extensions;

select plan(1);

select is(
  array(
    select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
    order by 1
  ),
  array[]::text[],
  'no trigger function in public is executable by anon or authenticated'
);

select * from finish();

rollback;
