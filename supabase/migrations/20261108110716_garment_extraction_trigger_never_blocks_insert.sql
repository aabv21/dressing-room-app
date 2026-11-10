-- The extraction trigger must never block a garment insert. It runs inside the
-- inserting transaction, so before this migration any error in the Vault read
-- or in net.http_post (pg_net misconfigured or upgraded on the hosted project,
-- a bad Vault URL, a permissions change on `net` or `vault`) rolled the insert
-- back and every upload ended on the failed tile. Extraction is optional: like
-- the missing-secret branch, a failure now queues no request and keeps the
-- row, which reaches review with empty fields once the app's pending timeout
-- passes.
--
-- The warning carries only the SQLSTATE: the error message could echo the
-- Vault URL, and the secret must never reach the logs.

create or replace function public.request_garment_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
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
  exception when others then
    raise warning 'request_garment_extraction: %', sqlstate;
  end;

  return new;
end;
$$;

revoke execute on function public.request_garment_extraction() from public, anon, authenticated;
