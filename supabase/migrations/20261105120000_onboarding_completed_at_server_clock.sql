-- `profiles.onboarding_completed_at` is stamped by the server clock, never the client's: when it
-- goes from null to non-null (on insert, or on update), whatever value the client sent is replaced
-- with now(). Once set it is immutable, so a later write (including a null) keeps the original
-- completion time and no client can move a finished profile back into onboarding.

create function public.stamp_onboarding_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.onboarding_completed_at is not null then
    new.onboarding_completed_at = old.onboarding_completed_at;
  elsif new.onboarding_completed_at is not null then
    new.onboarding_completed_at = now();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_onboarding_completed_at() from public, anon, authenticated;

create trigger profiles_stamp_onboarding_completed_at
  before insert or update of onboarding_completed_at on public.profiles
  for each row execute function public.stamp_onboarding_completed_at();
