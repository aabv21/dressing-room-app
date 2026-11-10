-- Tightens what a client can write to public.profiles:
--   * city_name gets the same 1–80 trimmed-length bound the app enforces;
--   * clients only ever update their row (the signup trigger creates it), so the insert policy
--     goes and a client insert is rejected by RLS;
--   * created_at is pinned on update, so it always records when the row was created;
--   * the anon role loses its default table privileges: nothing reads profiles signed out.
-- Duplicate styles/occasions are removed by the client. A CHECK can't hold a subquery, so a DB
-- guard would need a helper function that PostgREST would also expose as an RPC.

alter table public.profiles
  add constraint profiles_city_name_check check (
    city_name is null or char_length(btrim(city_name)) between 1 and 80
  );

drop policy "profiles_insert_own" on public.profiles;

revoke all on public.profiles from anon;

create function public.keep_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at = old.created_at;
  return new;
end;
$$;

revoke execute on function public.keep_created_at() from public, anon, authenticated;

create trigger profiles_keep_created_at
  before update on public.profiles
  for each row execute function public.keep_created_at();
