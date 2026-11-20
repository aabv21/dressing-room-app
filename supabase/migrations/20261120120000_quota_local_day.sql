-- The AI quotas reset at the user's local midnight, not UTC's: the app sends its local calendar day
-- with each request, and this version counts on that day when it is within one day of the UTC
-- date (every time zone is), else on the UTC day. The 3-argument version stays for
-- extract-attributes, which runs from a trigger with no client day.
-- NOTE: changing the device date can spread one user's calls over up to 3 day counters in 24 h;
-- acceptable at these limits. Upgrade path: a time zone stored on the profile.
create function public.consume_quota(p_user_id uuid, p_kind public.quota_kind, p_limit integer, p_day date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utc_day date := (now() at time zone 'utc')::date;
  v_day date;
  v_written boolean;
begin
  if p_limit < 1 then
    return false;
  end if;

  v_day := case when p_day between v_utc_day - 1 and v_utc_day + 1 then p_day else v_utc_day end;

  insert into public.usage_counters (user_id, day, kind, count)
  values (p_user_id, v_day, p_kind, 1)
  on conflict (user_id, day, kind) do update
    set count = public.usage_counters.count + 1
    where public.usage_counters.count < p_limit
  returning true into v_written;

  return coalesce(v_written, false);
end;
$$;

revoke execute on function public.consume_quota(uuid, public.quota_kind, integer, date) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, public.quota_kind, integer, date) to service_role;
