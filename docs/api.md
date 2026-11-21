# API: every endpoint the app and the server call

One place for every contract between the app, the Supabase project and the outside services: the
Edge Functions, the RPCs, the tables and Storage paths the app touches, the Auth calls, the work the
server starts by itself, and the providers the functions call. Algorithms, prompts and costs are in
[`ai.md`](ai.md); policies, grants and triggers in [`database.md`](database.md).

## Conventions

**Base URLs.** Hosted: `https://<ref>.supabase.co` (the project ref is in
[`owner-runbook.md`](owner-runbook.md)). Locally: `http://127.0.0.1:54421`
([`local-stack.md`](local-stack.md)). Functions live under `/functions/v1/<name>`, PostgREST under
`/rest/v1/`, Storage under `/storage/v1/`, Auth under `/auth/v1/`.

**Auth modes.**

| Mode | Header | Who uses it |
| --- | --- | --- |
| User JWT | `apikey: <anon key>`, `Authorization: Bearer <session token>` | The app, for every table, RPC, Storage and function call; the user-called functions re-use it to read the caller's rows under RLS |
| Webhook secret | `x-webhook-secret: <EXTRACT_WEBHOOK_SECRET>` | The garments insert trigger calling `extract-attributes` (`verify_jwt = false`) |
| Anon key | `apikey` and `Authorization: Bearer <anon key>` | `.github/workflows/keepalive.yml` calling `rpc/keep_alive`; the app before sign-in (Auth only) |
| Service role | `apikey` and `Authorization: Bearer <service-role key>` | Inside the functions only (quota, caches, `apple_tokens`, Storage, the Auth admin API), and the owner's scripts (`pnpm backup`, `pnpm calibrate export`). Never in `src/` |

Every user-called function has `verify_jwt = true` in `supabase/config.toml`, so the gateway checks
the token's signature first; the anon key passes the gateway but has no `sub`, and the function
answers 401. `gateway.test.ts` pins the setting per function.

**Bodies.** Requests and responses are JSON. An error is `{ "error": "<word>" }` with a non-2xx
status. A 200 either carries the result or, for the fire-and-forget and account functions,
`{ "outcome": "<word>" }`.

**Environment.** Each `index.ts` reads its variables once at startup through `_shared/env.ts`'s
`readEnv`, asking only for what that function uses. A missing required variable throws there, so the
worker never boots: the gateway answers an error (most likely a 503, which the app shows as
"unavailable") instead of the function running half-configured. The Apple variables are the
exception: `appleEnvFrom` answers null without them and the Apple calls are skipped.

**Shared code.** `_shared/http.ts` holds `json` and `reply` (the answer plus its logged outcome word),
`readJson`, `callerOf` (the bearer and its `sub`) and `fetchWithDeadline`, which every outbound call
uses so a stalled body can't outlive its timeout. `_shared/guards.ts` holds `isRecord` and the `UUID`
pattern.

**Logs.** Each function logs one JSON line per call with an outcome word (and the garment id for
`extract-attributes`), never a photo, profile, prompt, token or model answer. The words per function
are in [`ai.md`](ai.md) and in each section below.

**Idempotency.** `extract-attributes` writes back only while the garment is unchanged; `log_wear` is
keyed by a client wear id; `delete-account` is safe to retry; Storage uploads are upserts; the garment
insert is `on conflict do nothing`.

**Timeouts.**

| Where | Limit | Source |
| --- | --- | --- |
| App: any Supabase request | 12 s | `REQUEST_TIMEOUT_MS`, `src/lib/fetchWithTimeout.ts` |
| App: a `POST` to `/functions/v1/` | 45 s | `FUNCTION_TIMEOUT_MS` |
| App: a Storage upload | 60 s | `UPLOAD_TIMEOUT_MS` (signing and listing keep 12 s) |
| Functions: each PostgREST call | 8 s | `POSTGREST_TIMEOUT_MS`, `_shared/userContext.ts` |
| Functions: each Storage call | 10 s | `STORAGE_TIMEOUT_MS`, `_shared/photoStore.ts` |
| Functions: each Auth call in `delete-account` | 10 s | `AUTH_TIMEOUT_MS`, `delete-account/handler.ts` |
| Claude: extraction | 30 s | `CLAUDE_TIMEOUT_MS`, `extract-attributes/handler.ts` |
| Claude: rating fallback and For you lines | 20 s | `CLAUDE_TIMEOUT_MS`, `userContext.ts` (For you's lines also stop 38 s after the request arrived) |
| Jev | 10 s | `JEV_TIMEOUT_MS` |
| Open-Meteo forecast and geocoding | 5 s each | `WEATHER_TIMEOUT_MS` |
| Apple `/auth/token` and `/auth/revoke` | 10 s | `APPLE_TIMEOUT_MS`, `_shared/apple.ts` |
| pg_net, trigger → `extract-attributes` | 5 s | the trigger's `timeout_milliseconds`; the function keeps running after pg_net stops waiting |

**Quotas and caches.** Quotas count cache misses only, through `consume_quota`, before any paid
call. Rating, the lucky list and For you count the user's local day sent in the request, accepted
when it is within one day of the server's UTC date (else the UTC day); extraction, started by a
trigger with no client day, counts the UTC day.

| Function | Quota per user per day | Cache |
| --- | --- | --- |
| `extract-attributes` | 100 (`extraction`, UTC day) | none |
| `rate-outfit` | 50 (`rating`) | `rating_cache`; no age limit, a degraded result 1 hour |
| `lucky-list` | 10 (`lucky`) | `lucky_cache`; no age limit, a degraded list 1 hour |
| `for-you` | 1 (`for_you`) | `for_you_cache`; 7 days, a degraded answer 1 hour; one entry per user |
| any weather read | none | `weather_cache`, shared by place and UTC hour |

A daily `pg_cron` job prunes the caches ([Server-started work](#server-started-work)).

## Summary

| Endpoint | Caller (app module) | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `POST /functions/v1/extract-attributes` | The garments insert trigger, through pg_net | Webhook secret | `{ garment_id }` | 200 `{ outcome }` | 400, 401, 405, 500 |
| `POST /functions/v1/rate-outfit` | `src/outfits/aiClient.ts` `rateOutfit` | User JWT | `{ garment_ids, occasion, date }` | 200 `RatingResult` | 400, 401, 404, 405, 422, 429, 500, 503 |
| `POST /functions/v1/lucky-list` | `aiClient.ts` `fetchLuckyList` | User JWT | `{ date, occasion }` | 200 `LuckyResponse` | 400, 401, 405, 429, 500 |
| `POST /functions/v1/for-you` | `aiClient.ts` `fetchForYou` | User JWT | `{ language, date? }` | 200 `ForYouResponse` | 400, 401, 405, 429, 500 |
| `POST /functions/v1/apple-token` | `src/auth/socialAuth.ts` (fire-and-forget) | User JWT | `{ code }` | 200 `{ outcome }` | 401, 405 |
| `POST /functions/v1/delete-account` | `src/account/accountClient.ts` `deleteAccount` | User JWT (sent explicitly) | `{}` | 200 `{ outcome: 'deleted' }` | 401, 405, 500 |
| `POST /functions/v1/export-data` | `accountClient.ts` `exportData` | User JWT | `{}` | 200 `DataExport` | 401, 405, 500 |
| `POST /rest/v1/rpc/log_wear` | `src/outfits/outfitRepository.ts` `logWear` | User JWT | wear id, garment ids, day, occasion?, score? | the wear id | `22023`, `42501`, `23505` |
| `POST /rest/v1/rpc/save_outfit` | `outfitRepository.ts` `saveOutfit` | User JWT | garment ids, score? | the outfit id | `22023`, `42501` |
| `POST /rest/v1/rpc/keep_alive` | `.github/workflows/keepalive.yml` | Anon key | `{}` | the server time | none |
| `POST /rest/v1/rpc/consume_quota` | The functions | Service role | user, kind, limit, day? | `true` / `false` | — |
| `/rest/v1/profiles`, `garments`, `wears`, `outfits`, `dismissed_outfits` | The repositories | User JWT + RLS | select, update, insert, delete | rows | `42501`, `23514` |
| `/storage/v1/object/garments/…` | Upload queue, `garmentRepository.ts`, functions, backup | User JWT or service role | upload, sign, remove, download | — | Storage error statuses ([Storage](#storage)) |
| `/auth/v1/*` | `src/auth/emailAuth.ts`, `socialAuth.ts`, `accountClient.ts` | Anon key or session | sign-up, sign-in, recovery, ID tokens | session | Auth error codes |

## Edge Functions

Each function's logic is in `supabase/functions/<name>/handler.ts`, which exports its response
types; `index.ts` only wires Deno's environment to it.

### `extract-attributes`

Called by `public.request_garment_extraction()` after a garment insert, never by the app.

- Request: `POST { "garment_id": "<uuid>" }` with `x-webhook-secret`.
- Response: 200 `{ outcome }`, `ExtractOutcome` = `done` | `failed` | `over_quota` | `skipped`.

| Status | Body | When |
| --- | --- | --- |
| 405 | `{ error: 'method_not_allowed' }` | Not `POST` |
| 401 | `{ error: 'unauthorized' }` | Missing or wrong secret (constant-time compare) |
| 400 | `{ error: 'invalid_body' }` | Not `{ garment_id: <uuid> }` |
| 200 | `{ outcome: 'skipped' }` | Missing, no longer pending, reviewed, or edited before the write-back |
| 200 | `{ outcome: 'over_quota' }` | The 100-a-day quota is used up; Claude isn't called |
| 200 | `{ outcome: 'failed' }` | Quota or profile read error, photo missing, Claude error, refusal, timeout or invalid output |
| 200 | `{ outcome: 'done' }` | Attributes and `uncertain_fields` written |
| 500 | `{ error: 'internal' }` | Loading the garment or writing back failed |

The write-back filters on `extraction_status=eq.pending`, `reviewed_at=is.null` and the
`updated_at` read before the Claude call; why each guard is there:
[`ai.md`](ai.md#failure-mapping).

### `rate-outfit`

- Request: `POST { "garment_ids": [2–6 unique uuids], "occasion": <Occasion> | null, "date": "YYYY-MM-DD" }`.
  `occasion` is required: send `null` for none; a body without the key is a 400. `date` is the
  app's local day (`localDate()` in `aiClient.ts`).
- Response: `RatingResult` (`rate-outfit/handler.ts`): `score`, `label`, `confidence` (null for a
  Claude estimate), `estimated`, `reasons`, `weakestSlot`, `swap` (`{ fromId, toId, score }` or
  null) and `noBetterSwap`.

| Status | Body | Logged | When |
| --- | --- | --- | --- |
| 405 | `{ error: 'method_not_allowed' }` | `invalid` | Not `POST` |
| 401 | `{ error: 'unauthorized' }` | `invalid` | No user in the token |
| 400 | `{ error: 'invalid_input' }` | `invalid` | Malformed body |
| 404 | `{ error: 'garment_not_found' }` | `invalid` | An id that is gone or not the caller's (before any quota) |
| 422 | `{ error: 'incomplete' }` | `invalid` | A garment without a category, or no (top + bottom or one-piece) + shoes |
| 200 | `RatingResult` | `cached` | Cache hit; a cached swap whose target is no longer available is answered as `swap: null` |
| 429 | `{ error: 'over_quota' }` | `over_quota` | 50 misses already today |
| 200 | `RatingResult` | `rated` / `fallback` | Jev rated it, or Claude did (`estimated: true`) |
| 503 | `{ error: 'rating_unavailable' }` | `unavailable` | Jev and Claude both failed; nothing cached, the quota is spent |
| 500 | `{ error: 'internal' }` | `error` | Loading garments or the profile, or the quota RPC, failed |

### `lucky-list`

- Request: `POST { "date": "YYYY-MM-DD", "occasion": <Occasion> | null }` (`occasion` required, as
  above).
- Response: `LuckyResponse` (`lucky-list/handler.ts`): `{ kind: 'too_small', missing, weather }` or
  `{ kind: 'ok', weather, outfits: { garmentIds, score, freshThisWeek }[] }`, where `score` is null
  for an outfit whose rating failed or was skipped.
- Reads the caller's garments, profile and `dismissed_outfits` with the user's token. No outfit is a
  dismissed combination or holds a garment with `suggest = false`; dismissing one or turning a
  piece off changes the cache key, so the next call is a miss ([`ai.md`](ai.md#the-lucky-list-function)).

| Status | Body | Logged | When |
| --- | --- | --- | --- |
| 405 / 401 / 400 | as in `rate-outfit` | `invalid` | Method, token, body |
| 200 | `too_small` | `too_small` | A required slot has no available garment; no cache, quota or Jev |
| 200 | cached list | `cached` | Cache hit, with this hour's weather |
| 429 | `{ error: 'over_quota' }` | `over_quota` | 10 misses already today |
| 200 | list | `ranked` / `degraded` / `empty` | Ranked; a rating or the forecast failed; no candidate passes the rules (`outfits: []`) |
| 500 | `{ error: 'internal' }` | `error` | Loading garments, the profile or the dismissed outfits, or the quota RPC, failed |

### `for-you`

- Request: `POST { "language": "en" | "es", "date"?: "YYYY-MM-DD" }`. `date` is optional: the app's
  local day picks the season and the quota day; an older app that sends none (or an invalid one)
  gets the UTC day. With no stored coordinates, a typed city is geocoded for its latitude
  (`geocodedLatitude`, 5 s); without one there is no season rule.
- Response: `ForYouResponse` (`for-you/handler.ts`): `{ kind: 'too_small' }` or
  `{ kind: 'ok', ideas: ForYouCard[] }`, each card `{ id, category, colors, newOutfits,
  combinesWith, line, lineKey, lineParams, searchQuery }`. A garment with `suggest = false` still
  owns its archetype but counts in no idea's outfits.

| Status | Body | Logged | When |
| --- | --- | --- | --- |
| 405 / 401 | as in `rate-outfit` | `invalid` | Method, token |
| 400 | `{ error: 'invalid_input' }` | `invalid` | Malformed body or another language |
| 200 | `too_small` | `too_small` | Fewer than 3 wardrobe garments with a category |
| 200 | ideas | `cached` | A fresh entry for the key |
| 200 | ideas | `stale` | Over the quota: the key's expired entry, else the user's newest entry minus owned ideas |
| 429 | `{ error: 'over_quota' }` | `over_quota` | Over the quota with nothing left to show |
| 200 | ideas | `ranked` / `degraded` / `empty` | Computed; a fit or line fell back; no archetype with gain |
| 500 | `{ error: 'internal' }` | `error` | Loading garments or the profile, or the quota RPC, failed |

### `apple-token`

Sent right after Sign in with Apple with the credential's one-time authorization code; the app
never waits for it.

- Request: `POST { "code": "<authorization code>" }` (at most 2,048 characters).
- Response: 200 `{ outcome }`, `AppleTokenOutcome` (`apple-token/handler.ts`) = `stored` |
  `skipped` (no `APPLE_*` secrets) | `invalid` (no usable code) | `exchange_failed` |
  `identity_mismatch` | `lookup_failed` | `store_failed`. The token never leaves the server.
- 405 `{ error: 'method_not_allowed' }` for another method, 401 `{ error: 'unauthorized' }` for a
  token without a user. Everything past the caller check answers 200.

### `delete-account`

- Request: `POST {}` with the session's token set explicitly in `Authorization`.
- Response: 200 `{ outcome: 'deleted' }`, also for a retry after the user is already gone.
- 405 and 401 as above; 500 `{ error: 'internal' }` when the caller check, the listing, the removal,
  the user deletion or a sweep fails, with the user still there (or already gone, swept again next
  time). Steps and retries: [`database.md`](database.md#account-deletion-and-data-export-plan-5).
- The app counts a 401 as deleted only when Auth's `GET /user` with that same token answers
  `user_not_found` ([`app.md`](app.md#account-deletion-on-the-device)).

### `export-data`

- Request: `POST {}`.
- Response: `DataExport` (`export-data/handler.ts`): `{ exportedAt, profile, garments, outfits (each
  with items: [{ garment_id }]), wears, dismissedOutfits, photos: [{ garmentId, full, thumb }] }`.
  The app refuses a document without `dismissedOutfits` (`isDataExport`), so the function ships
  before or with an app that reads it. Rows are read with
  the caller's token in pages of 1000 (`PAGE`); photo URLs are signed for 7 days
  (`SIGNED_URL_TTL_S`).
- 405 and 401 as above; 500 `{ error: 'internal' }` when a read or the signing fails.

## RPCs

| RPC | Signature | Who may call | Notes |
| --- | --- | --- | --- |
| `log_wear` | `(p_wear_id uuid, p_garment_ids uuid[], p_worn_on date, p_occasion occasion default null, p_score smallint default null) returns uuid` | `authenticated` | `security invoker`. Idempotent on `p_wear_id`. `22023` for fewer than 2 or duplicate ids, `42501` for a garment that isn't the caller's, `23505` for another user's wear id |
| `save_outfit` | `(p_garment_ids uuid[], p_score smallint default null) returns uuid` | `authenticated` | Same validation; stamps `saved_at` and stores `p_score` (0–100), logs no wear. A call with `p_garment_ids` alone (older builds) still resolves to it |
| `keep_alive` | `() returns timestamptz` | `anon` (the only anon grant) | Answers `now()`, reads no table |
| `consume_quota` | `(p_user_id uuid, p_kind quota_kind, p_limit integer) returns boolean` | `service_role` | The UTC day; extraction only |
| `consume_quota` | `(p_user_id uuid, p_kind quota_kind, p_limit integer, p_day date) returns boolean` | `service_role` | `p_day` when within one day of the UTC date, else the UTC day (`20261120120000_quota_local_day.sql`) |

`prune_expired_caches()` is not callable from the API (execute revoked from `anon` and
`authenticated`); only the cron job runs it. Details: [`database.md`](database.md#logging-a-wear).

## Tables the app reads and writes

All through PostgREST with the user's JWT; RLS limits every row to the caller's own.

| Table | App calls | Client grants beyond RLS | Module |
| --- | --- | --- | --- |
| `profiles` | select own; update changed columns only (never upsert); `completeOnboarding` sends `'now'` | No insert or delete policy; `created_at` kept and `onboarding_completed_at` stamped by triggers | `src/profile/profileRepository.ts` |
| `garments` | select all own, newest first; upsert `{ id, user_id }` ignoring duplicates; update attributes, status, `pinned_on`, `suggest`, `photo_version`, `reviewed_at`; delete | Insert only `id`, `user_id`; update only the attribute columns, `status`, `photo_version`, `reviewed_at`, `pinned_on`, `suggest` | `src/closet/garmentRepository.ts`, `src/closet/upload/queueSteps.ts` |
| `wears` | select by `worn_on` range with `outfits(outfit_items(garment_id))`, pages of 1000, at most 20; delete own | No update; insert only through `log_wear` in practice | `src/stats/wearsRepository.ts` |
| `outfits`, `outfit_items` | select saved outfits with `outfit_items(garment_id)`, newest first; delete a saved one (its items cascade); otherwise through the RPCs and inside `wears` selects | No update; delete only on `outfits`, and only a saved outfit no wear points at | `src/outfits/savedOutfits.ts` |
| `dismissed_outfits` | insert `{ outfit_key }` ignoring duplicates | Select, insert, delete own; no update | `src/outfits/suggestionFeedback.ts` |

The caches, `usage_counters` and `apple_tokens` have no client grants at all.

## Storage

Bucket `garments`: private, 2 MiB per object, `image/webp`, `image/png` or `image/jpeg`. Paths are
`{user id}/{garment id}/full.webp` (784 px) and `thumb.webp` (256 px).

| Operation | Caller | Auth | Notes |
| --- | --- | --- | --- |
| Upload (upsert) | Upload queue, `uploadGarmentPhotoBytes` | User JWT | Folder policy: the first path segment must be the caller's id. 60 s app timeout. A 4xx other than 401, 403, 408 and 429 is a `PermanentUploadError`, which retrying can't fix |
| Sign (`createSignedUrls`) | `signedPhotoUrls` (used by `ClosetProvider` and `GarmentPhoto.tsx`) | User JWT | 1 hour |
| Remove | `deleteGarment` (photos before the row); `queueSteps.ts` for a replacement whose garment was deleted meanwhile | User JWT | A missing object isn't an error |
| List, remove, sign, download | Functions, only through `_shared/photoStore.ts` | Service role | Download for extraction; 7-day signing for the export; list and remove for deletion |
| List and download | `scripts/backup.ts` | Service role | Every object, into the nightly backup |

## Auth calls the app makes

All through supabase-js against `/auth/v1/`; the session is stored in SQLite (`src/lib/supabase.ts`).

| Call | Module | Notes |
| --- | --- | --- |
| `signUp({ email, password })` | `emailAuth.ts` | 8 characters minimum on the server too; email confirmation is off locally and a hosted decision ([`owner-runbook.md`](owner-runbook.md)) |
| `signInWithPassword` | `emailAuth.ts` | |
| `resetPasswordForEmail(email)` | `emailAuth.ts` | Sends the 6-digit recovery code (`supabase/templates/recovery.html`); `over_email_send_rate_limit` is reported as sent. Mailpit catches it locally (`http://127.0.0.1:54424`); hosted, Brevo sends it from `hello.aabv21@gmail.com` |
| `verifyOtp({ email, token, type: 'recovery' })`, then `updateUser({ password })` | `emailAuth.ts` | The reset's second step; a failed update signs out locally |
| `signOut()` / `signOut({ scope: 'local' })` | `emailAuth.ts` (through `authService.ts`, used by `useSignOut.ts`) | Offline falls back to a local sign-out |
| `signInWithIdToken({ provider: 'apple', token, nonce })` | `socialAuth.ts` | iOS only; the raw nonce is sent, its SHA-256 went to Apple |
| `signInWithIdToken({ provider: 'google', token })` | `socialAuth.ts` | No nonce, so `skip_nonce_check` is on (see [`red-team.md`](red-team.md#parked)) |
| `getSession()` | `queueSteps.ts`, `accountClient.ts` | The session check before a queued step or a deletion |
| `getUser(token)` | `accountClient.ts` | `user_not_found` proves a deletion; never refreshes |

The functions also call Auth: `GET /auth/v1/user` with the caller's token (`delete-account`), and the
admin API with the service role (`GET` and `DELETE /auth/v1/admin/users/{uid}`, in `apple-token` and
`delete-account`).

## Server-started work

| Job | Schedule | What it calls |
| --- | --- | --- |
| Extraction trigger | After each garment insert | `garments_request_extraction` → `net.http_post` (5 s) to `extract-attributes`, URL and secret from the Vault; nothing when either is missing |
| `prune-expired-caches` | `pg_cron`, daily at 04:00 UTC | `public.prune_expired_caches()`, which deletes cache rows past their lifetime ([`database.md`](database.md)) |
| Keep-alive | GitHub Actions, daily at 14:23 UTC (`23 14 * * *`), and by hand | `POST rpc/keep_alive` with the anon key, from the repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY`; GitHub stops it after 60 days without repo activity |
| Backup | launchd on the owner's Mac, daily at 03:30 local time | `pnpm backup`: two `supabase db dump` runs and every Storage object ([`owner-runbook.md`](owner-runbook.md#7-backups)) |

## Outside providers and their local mocks

Only the Edge Functions call them. Locally every base URL points at a mock on the host
(`http://host.docker.internal:<port>`), set in `supabase/config.toml`'s `[edge_runtime.secrets]`;
hosted, the URLs stay unset and default to the real hosts.

| Provider | Endpoint | Default host | Local mock |
| --- | --- | --- | --- |
| Anthropic (Claude Haiku 5.5) | `POST /v1/messages` | `https://api.anthropic.com` | `integration/mockAnthropic.ts`, port 54499 |
| TypeSafe (Jev) | `POST /v1/systemone` | `https://api.typesafe.ai` | `integration/mockServices.ts`, port 54498 |
| Open-Meteo forecast | `GET /v1/forecast` | `https://api.open-meteo.com` | `mockServices.ts`, 54498 |
| Open-Meteo geocoding | `GET /v1/search` | `https://geocoding-api.open-meteo.com` | `mockServices.ts`, 54498 |
| Apple | `POST /auth/token`, `POST /auth/revoke` | `https://appleid.apple.com` | `mockServices.ts`, 54498 |
| Brevo (Auth's SMTP) | SMTP `smtp-relay.brevo.com:587` | hosted Auth only | Mailpit, port 54424 |

How to run the mocks: [`local-stack.md`](local-stack.md#mocks).

## How the app maps errors

`src/outfits/aiClient.ts` turns a function failure into an `AiError` the screens translate:

| Function answer | `AiError` |
| --- | --- |
| 404 | `not_found` |
| 422 | `incomplete` |
| 429 | `over_quota` |
| 503 | `unavailable` |
| Any other HTTP status (400, 401, 500…) or an empty body | `unknown` |
| `FunctionsFetchError` or `TypeError` (no answer, a timeout) | `network` |

`src/account/accountClient.ts` maps to `network` | `unknown` | `reauth` (a 401 Auth doesn't explain
as a deleted user, or no session). The repositories map write results through
`src/lib/requestResult.ts`'s `runRequest` to `network` | `invalid` | `unknown`.

## Changing an endpoint

1. Change the handler and its `handler.test.ts`; keep `index.ts` Deno-only and the logic in
   `handler.ts`.
2. If the response shape changes, update the exported type; `src/outfits/types.ts` re-exports it,
   so the app's typecheck follows. Bump the function's `CACHE_VERSION` when cached results change.
3. Update the app's caller and its error mapping (`aiClient.ts` or `accountClient.ts`) and tests.
4. A new function needs its `[functions.<name>]` section in `supabase/config.toml`
   (`gateway.test.ts` checks it) and its integration test.
5. A table, RPC or grant change is a new migration, `pnpm db:types` and pgTAP
   ([`database.md`](database.md#how-to-add-a-migration)).
6. Update this file, [`ai.md`](ai.md) for prompts or costs, and [`architecture.md`](architecture.md)
   for a changed lifecycle.
7. Old app builds keep calling the old contract: accept the old request (as `for-you` does for a
   missing `date`) until every installed build sends the new one.
