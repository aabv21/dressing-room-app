# The local stack

The local backend is Supabase in Docker (via OrbStack), driven only through the `supabase` npm
devDependency (`pnpm exec supabase …` or the `db:*` scripts), never a global or Homebrew install.
Nothing local reaches a real AI, weather or Apple API: every outside call goes to a mock on the host.

## Commands

- `pnpm db:start`: starts the stack (Postgres, Auth, REST, Storage, Studio, Mailpit, Edge Runtime)
  through `scripts/db-start.ts`, which first generates the local Apple test key (see
  [Mock Apple](#mock-apple)). The first run pulls Docker images and can take minutes.
- `pnpm db:start:ci`: the lean stack CI starts (Postgres, Auth, REST, Storage, Kong, postgres-meta,
  Mailpit, Edge Runtime), without Studio, Realtime, analytics or the image proxy.
- `pnpm db:reset`: recreates the database from `supabase/migrations/` and `supabase/seed.sql`.
- `pnpm db:test`: the pgTAP suite under `supabase/tests/` ([`testing.md`](testing.md#pgtap-supabaseteststestsql)).
- `pnpm db:types`: regenerates `src/lib/database.types.ts`; commit it with the migration that
  changed it.
- `pnpm env:local`: writes `.env.local` (gitignored) from `supabase status -o env`: the app's
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` and
  `SUPABASE_DB_URL` for scripts and integration tests only. It writes only those four keys, in that
  order, and keeps every other line, so the Google client ids copied from `.env.example` survive.
- `pnpm db:stop`: stops the stack. Leave it stopped when you're done.

## Ports and endpoints

The stack uses its own port block, 54420–54429 (`supabase/config.toml`):

| Service | Address |
| --- | --- |
| API gateway (REST, Auth, Storage, functions) | `http://127.0.0.1:54421` |
| Postgres | `127.0.0.1:54422` (user and password `postgres`) |
| Studio | `http://127.0.0.1:54423` |
| Mailpit | `http://127.0.0.1:54424` |
| Mock Jev, Open-Meteo and Apple | `54498` on the host |
| Mock Claude | `54499` on the host |

The Edge Runtime serves every function at `http://127.0.0.1:54421/functions/v1/<name>` and reloads
on file changes; its logs are in `docker logs supabase_edge_runtime_dressing-room-app`.

## Auth and email

- Mailpit catches local email (sign-up confirmations, which are off, and reset codes) instead of
  sending it ([`testing.md`](testing.md#reading-reset-codes-from-mailpit)).
- Password reset uses a 6-digit code (`{{ .Token }}` in `supabase/templates/recovery.html`), not a
  link.
- Passwords need at least 8 characters on the server too (`minimum_password_length`); the hosted
  project mirrors it.
- NOTE: `requestPasswordReset` reports `over_email_send_rate_limit` as sent, and GoTrue uses that
  code for the project-wide hourly email cap too (`[auth.rate_limit].email_sent`, 2 locally); the
  hosted limit is 30 an hour ([`owner-runbook.md`](owner-runbook.md#3-secrets-keys-and-spend-caps)).

## Function secrets

The local secrets are literal, local-only values in `supabase/config.toml`'s
`[edge_runtime.secrets]` (`EXTRACT_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`,
`TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `OPEN_METEO_URL`, `OPEN_METEO_GEOCODING_URL`,
`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_BASE_URL`; `APPLE_PRIVATE_KEY` comes from
the environment). They apply when the stack starts, so restart it after changing them.
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the runtime.

Those values must never reach the hosted project: `supabase secrets set` run from this repo pushes
them too. Hosted secrets are set from an empty directory
([`owner-runbook.md`](owner-runbook.md#setting-a-hosted-secret)).

`rate-outfit`, `lucky-list`, `for-you`, `apple-token`, `delete-account` and `export-data` run with
`verify_jwt = true`: the anon key passes the gateway but has no user, and the function answers 401.

## The extraction trigger's Vault secrets

The garments insert trigger reads the function URL and webhook secret from the Vault secrets
`extract_attributes_url` and `extract_webhook_secret`, which `supabase/seed.sql` creates on every
`pnpm db:reset`. The URL uses Kong's container name, since pg_net runs inside the db container
([`database.md`](database.md#extraction-trigger)).

## Cache cleanup

The migrations enable `pg_cron` and schedule `prune-expired-caches` daily at 04:00 UTC. The
lifetimes follow `_shared/userContext.ts`'s `DEGRADED_TTL_MS` and For you's `FOR_YOU_TTL_MS`; change
the function in a new migration if either changes ([`database.md`](database.md)).

## Mocks

Every outside base URL in `[edge_runtime.secrets]` points at `http://host.docker.internal:<port>`,
where a mock on the host answers. Endpoints and hosted defaults are in
[`api.md`](api.md#outside-providers-and-their-local-mocks).

### Mock Claude

`integration/mockAnthropic.ts`: `startMockAnthropic(port = 54499)` serves `POST /v1/messages` on
`0.0.0.0`. `respondWith({ status, body })` (with an optional `delayMs`) or `respondWith({ hang: true })`
sets the reply for every following call; `calls()` counts the calls; `close()` also drops hung
connections. Replies reuse the recorded fixtures in `supabase/functions/_shared/__tests__/fixtures/`.
`extraction.int.test.ts` and `outfits.int.test.ts` start it. With no mock running, extraction ends
`failed`. For a manual check in the simulator:

```bash
node integration/mockAnthropic.ts --serve <fixture>   # answers every call with claude-<fixture>.json (ok, low-confidence, …)
```

### Mock Jev and Open-Meteo

`integration/mockServices.ts`: `startMockServices(port = 54498)` serves `POST /v1/systemone` (Jev),
`GET /v1/forecast` and `GET /v1/search` (geocoding) on `0.0.0.0`; `TYPESAFE_API_KEY` is a
placeholder. `jev(next)`, `forecast(next)` and `geocode(next)` set each route's reply (`MockReply`);
`jev` also takes a function of the request body, and `jevAnswers(request, level)` builds a
well-formed answer to every question (each Score at `level` of its range, so the composite is
`round(100 · level)`; each Noul at 0.02; each Choice `none`). `calls(path)` counts calls. Until set,
Jev answers every Score at its best level, the forecast is `MILD_FORECAST` (a dry 19 °C day) and
geocoding finds Madrid. With no mock running, `rate-outfit` falls back to Claude and the weather is
unknown. For a manual check:

```bash
node integration/mockServices.ts --serve [--level <0..1> | --weak <category>] [--temp <°C>]
```

`--level` sets every Jev answer (default 1). `--weak` scores outfits holding that category low and
names it the weakest piece, so the rating offers a swap (what `pnpm e2e` uses); it refuses
`--level`. `--temp` makes a clear, dry day around that temperature.

### Mock Apple

`APPLE_BASE_URL` points at port 54498 too, where `mockServices.ts` serves Apple's `POST /auth/token`
and `POST /auth/revoke` while `account.int.test.ts` runs. The local team, key and client ids are made
up. No key is committed: `config.toml` reads `APPLE_PRIVATE_KEY = "env(LOCAL_APPLE_PRIVATE_KEY)"`,
and `scripts/db-start.ts` generates a P-256 key into gitignored `supabase/.temp/apple-test-key.pem`
when it's missing (kept across restarts, never registered with Apple) and passes it to
`supabase start`; `account.int.test.ts` reads the same file. A bare `pnpm exec supabase start`
leaves the key unset, so `apple-token` answers `skipped` and deletion skips the revoke, as on a
hosted project without the secrets. With no mock running, `apple-token` answers `exchange_failed`
and deletion logs `revoke_failed` and goes on.

### Logs

Function logs (one line per call) are in `docker logs supabase_edge_runtime_dressing-room-app`;
pg_net's view of each call is in `net._http_response` (a `timed_out` row is expected when Claude
hangs, since pg_net stops waiting after 5 s while the function carries on).
