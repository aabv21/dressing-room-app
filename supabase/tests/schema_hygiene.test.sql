-- Schema-wide rules from docs/database.md's "New table checklist", checked generically so a future
-- table or function that misses one fails here instead of passing unnoticed:
--   * no trigger function in `public` is directly executable by a client role;
--   * no plain index in `public` is made redundant by another index on the same table that starts
--     with the same columns (the longer one already serves every lookup the shorter one would).
begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

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

select is(
  array(
    select shorter.indexrelid::regclass::text
    from pg_index shorter
    join pg_index longer
      on longer.indrelid = shorter.indrelid
     and longer.indexrelid <> shorter.indexrelid
    join pg_class t on t.oid = shorter.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and not shorter.indisunique
      and shorter.indpred is null
      and longer.indpred is null
      and shorter.indnkeyatts <= longer.indnkeyatts
      and (shorter.indkey::int2[])[0:shorter.indnkeyatts - 1]
        = (longer.indkey::int2[])[0:shorter.indnkeyatts - 1]
    order by 1
  ),
  array[]::text[],
  'no index in public is a leading-column prefix of another index on the same table'
);

-- The rule above must not flag the index Stats and Diary read wears through.
select has_index('public', 'wears', 'wears_user_id_worn_on_idx', 'wears keeps its (user_id, worn_on desc) index');

select * from finish();

rollback;
