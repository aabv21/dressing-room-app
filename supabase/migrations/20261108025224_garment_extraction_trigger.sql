-- Attribute extraction request: after a garment row is inserted, pg_net POSTs
-- `{garment_id}` to the extract-attributes Edge Function, which fills in the
-- attributes and ends the row's `pending` extraction state. The function URL
-- and the shared webhook secret live in Vault (seeded locally by seed.sql, set
-- by hand on the hosted project), never in a migration.
--
-- pg_net queues the request inside the inserting transaction and sends it
-- after commit, so a rolled-back insert calls nothing, and an
-- `on conflict do nothing` duplicate inserts no row and fires no trigger.

create extension if not exists pg_net with schema extensions;

create function public.request_garment_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'extract_attributes_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'extract_webhook_secret';

  -- Not configured (e.g. a fresh hosted project): keep accepting garments;
  -- they reach review with empty fields once the app's pending timeout passes.
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('garment_id', new.id),
    headers := jsonb_build_object('content-type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke execute on function public.request_garment_extraction() from public, anon, authenticated;

create trigger garments_request_extraction
  after insert on public.garments
  for each row execute function public.request_garment_extraction();
