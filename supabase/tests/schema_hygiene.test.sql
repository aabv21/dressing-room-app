-- Schema-wide rules from docs/database.md's "New table checklist", checked generically so a future
-- table or function that misses one fails here instead of passing unnoticed:
--   * no trigger function in `public` is directly executable by a client role;
--   * no plain index in `public` is made redundant by another index on the same table, of the same
--     access method, that starts with the same columns in the same operator classes (the longer one
--     already serves every lookup the shorter one would).
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

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

-- The redundant-index rule, as a function of the schema so the fixtures below can pin it.
create function pg_temp.redundant_indexes(schema_name text) returns text[]
language sql stable as $$
  select coalesce(array_agg(shorter.indexrelid::regclass::text order by 1), array[]::text[])
  from pg_index shorter
  join pg_index longer
    on longer.indrelid = shorter.indrelid
   and longer.indexrelid <> shorter.indexrelid
  join pg_class si on si.oid = shorter.indexrelid
  join pg_class li on li.oid = longer.indexrelid
  join pg_class t on t.oid = shorter.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = schema_name
    and not shorter.indisunique
    and shorter.indpred is null
    and longer.indpred is null
    and si.relam = li.relam
    and shorter.indnkeyatts <= longer.indnkeyatts
    -- A key of 0 is an expression; two expression keys can't be compared through pg_index alone.
    and not 0 = any ((shorter.indkey::int2[])[0:shorter.indnkeyatts - 1])
    and (shorter.indkey::int2[])[0:shorter.indnkeyatts - 1]
      = (longer.indkey::int2[])[0:shorter.indnkeyatts - 1]
    and (shorter.indclass::oid[])[0:shorter.indnkeyatts - 1]
      = (longer.indclass::oid[])[0:shorter.indnkeyatts - 1]
$$;

select is(
  pg_temp.redundant_indexes('public'),
  array[]::text[],
  'no index in public is a leading-column prefix of another index on the same table'
);

-- Fixtures: only a same-method, same-operator-class, plain-column prefix is redundant.
create schema hygiene_fixture;
create table hygiene_fixture.t (a int, b int, c int, d text, e text, f int);
create index redundant_idx on hygiene_fixture.t (a);
create index a_b_idx on hygiene_fixture.t (a, b);
create index c_hash_idx on hygiene_fixture.t using hash (c);
create index c_f_idx on hygiene_fixture.t (c, f);
create index d_pattern_idx on hygiene_fixture.t (d text_pattern_ops);
create index d_f_idx on hygiene_fixture.t (d, f);
create index lower_e_idx on hygiene_fixture.t (lower(e));
create index upper_e_f_idx on hygiene_fixture.t (upper(e), f);

select is(
  pg_temp.redundant_indexes('hygiene_fixture'),
  array['hygiene_fixture.redundant_idx'],
  'the rule flags a plain prefix but not another access method, operator class or expression'
);

-- The rule above must not flag the index Stats and Diary read wears through.
select has_index('public', 'wears', 'wears_user_id_worn_on_idx', 'wears keeps its (user_id, worn_on desc) index');

select * from finish();

rollback;
