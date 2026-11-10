-- Local-only Vault secrets for the garments insert trigger
-- (public.request_garment_extraction). No reference data is seeded: enums carry
-- the fixed vocabularies, and `public.profiles` rows are created by the
-- `handle_new_user()` trigger on signup. The hosted project sets its own
-- values by hand (see docs/database.md), never from this file.

-- Must match EXTRACT_WEBHOOK_SECRET in supabase/config.toml's [edge_runtime.secrets].
select vault.create_secret('local-only-not-a-secret', 'extract_webhook_secret');

-- The function as seen from the db container: Kong's container name on the
-- stack's Docker network (pg_net runs inside the db container, where 127.0.0.1
-- is the container itself). Proven by integration/extraction.int.test.ts.
select vault.create_secret(
  'http://supabase_kong_dressing-room-app:8000/functions/v1/extract-attributes',
  'extract_attributes_url'
);
