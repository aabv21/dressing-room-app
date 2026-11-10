-- `public.set_updated_at()` (the `updated_at` trigger on profiles and garments) kept Postgres's and
-- Supabase's default `execute` grants: the only function in `public` that missed the "revoke
-- execute on every new function" rule. A trigger function can't be called directly anyway, so
-- this changes no behavior; it closes the gap so every function's grants follow the same rule.
-- The triggers keep firing: revoking execute only blocks direct calls.

revoke execute on function public.set_updated_at() from public, anon, authenticated;
