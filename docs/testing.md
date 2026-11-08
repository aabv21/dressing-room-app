# Testing

Four Jest projects, one pgTAP suite. `pnpm test` runs the three that need no Docker; `pnpm test:int`
and `pnpm db:test` need a running local Supabase stack (see `AGENTS.md`'s "Local backend").

## Jest projects (`jest.config.ts`)

### `app`

Component and hook tests under `src/**/*.test.[jt]sx?`, running under `jest-expo`'s React Native
environment. `jest.setup.ts` mocks:

- `react-native-safe-area-context` — the package's own Jest mock, so insets are deterministic.
- `expo-localization` — `getLocales()` returns a fixed `en-US` locale, so i18n-dependent tests don't
  depend on the host machine's language.
- `expo-sqlite/kv-store` — replaced with an in-memory `Map` behind the same synchronous
  `getItemSync`/`setItemSync`/`removeItemSync` API `src/lib/kv.ts` calls, since there is no native
  SQLite module under Jest.

Uses `@testing-library/react-native` v14: `await render(...)` and `await fireEvent...` (both are
async in v14).

The closet suites (Plan 3) render each screen directly, with the closet, upload queue, repository
and profile seams mocked by `jest.mock`, and build garment rows with `src/test/garmentFixture.ts`:

- `src/closet/__tests__/` — `catalog.test.ts` (the enums match `database.types.ts`, slots and the
  per-clothing-type categories, every label translated), `closetSelectors.test.ts` (stale pending,
  the review queue, the fields review asks about, slot counts, grid cells), `ClosetGrid.test.tsx`,
  `GarmentFields.test.tsx` (each field's chips and what they store, a disabled editor,
  `changedFields`), `garmentRepository.test.ts` (the queries and storage calls against a fake
  client, error mapping, delete order), `ClosetProvider.test.tsx` (refresh, the kv offline copy,
  re-signing, polling, late results after sign-out or a user switch, foreground and reconnect),
  `UploadQueueProvider.test.tsx` (when the queue runs, counts, retry/discard, the backoff timer) and
  `ClosetScreen.test.tsx` (the goal card, slot chips, the review banner, the processing and failed
  tiles, the gallery picker, opening a garment).
- `src/closet/upload/__tests__/` — `queueStore.test.ts` (SQLite rows through a fake database:
  enqueue, replacements, conditional saves), `runQueue.test.ts` (stages, resuming an interrupted
  item, backoff, failing after 8 attempts or a permanent error, an attempt claimed before a stage
  runs so a native crash still counts toward the 8, concurrency 2), `preparePhoto.test.ts`
  (the resize arguments for portrait, landscape and small photos, one decode capped at 784 px with
  the thumbnail built from it, WebP qualities, the cut-out or the source photo), `cutout.test.ts` (the native
  module present, missing, or throwing) and `queueSteps.test.ts` (the real steps, the session check,
  replacements).
- `src/__tests__/camera.test.tsx` — the burst camera: permissions, the shutter and shot strip, Done,
  and the Discard / Keep shooting confirm on Close and on a back gesture.
- `src/__tests__/review.test.tsx` — the review queue: only the doubted fields are asked, Skip and
  Confirm, the card stays pinned while polling reorders the queue, a save error by the buttons.
- `src/__tests__/garment-detail.test.tsx` — the garment detail: a save sends only the changed field
  and is disabled until something changed, a network error keeps the edit, the status saves at once
  and reverts on error, delete confirms first and goes back (or to the closet with no history), a
  failed delete keeps the screen, Replace photo queues the picked photo, editors are disabled while
  the AI is still reading, and an unknown id shows "not found".

### `scripts`

Tests for `scripts/**/*.test.ts` (repo tooling, e.g. `scripts/env-local.ts`), running under plain
Node — no Expo globals, no React Native. Kept out of the `app` project because `jest-expo`'s preset
installs lazy globals (`fetch`, `structuredClone`, …) that conflict with a `scripts` test file's own
`@jest-environment node` docblock during teardown.

### `functions`

Tests for the Supabase Edge Function logic under `supabase/functions/**/*.test.ts`, running under
plain Node like `scripts`. Function code is runtime-neutral TypeScript with explicit `.ts` imports;
only each function's `index.ts` touches Deno, and no test imports it. The `extract-attributes`
handler takes `fetch` as a dependency, so its tests use a fake `fetch` that routes by URL and method
and records every call, and Jest fake timers drive the 30 s Claude timeout. Claude responses come
from recorded-shape fixtures in `supabase/functions/_shared/__tests__/fixtures/`; the real API is
never called. See `docs/ai.md`. To run only this project:
`NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects functions` (a path argument to
`pnpm test` doesn't narrow it).

- `supabase/functions/_shared/__tests__/extraction.test.ts` — the Claude request (the model, 600
  `max_tokens`, the category enum limited to the clothing type, the image block, a system prompt
  that ignores text in the image) and the response sanitizer: a refusal, `is_garment: false` or
  non-JSON fails; only enum values survive, at most 3 colors, and a dropped value marks its field
  uncertain.
- `supabase/functions/extract-attributes/__tests__/handler.test.ts` — the webhook secret and method
  checks, the happy path, an exhausted quota (`over_quota`, no Claude call), a Claude call aborted
  after 30 s (`failed`), a garment no longer pending or missing, and logs that carry only the garment
  id and an outcome word.

### `integration`

`integration/*.int.test.ts`, also plain Node, exercising real behavior against a running local
Supabase stack:

- `auth.int.test.ts` — email/password sign-up and sign-in, the server's 8-character password
  minimum, and the password-reset code flow (via Mailpit; see below).
- `rls.int.test.ts` — the cross-user RLS boundary: user A can never read, update, list or delete
  user B's `profiles` row or storage objects. Also: A can't insert a profile row or delete their own,
  and uploads outside the three image MIME types or over 2 MiB are rejected.
- `profile.int.test.ts` — `profileRepository`'s server-clock `onboarding_completed_at` stamping,
  `saveProfile` updating only the given columns (one coordinate of a stored pair saves on its own),
  the 80-character city limit, an error for a session that can't reach the row, and the
  `profile.language` round-trip.
- `garments.int.test.ts` — `public.garments` and the photo folder through supabase-js: user B can't
  select, update or delete A's garment, download A's `full.webp` or upload into A's folder; the same
  id inserted twice with `upsert(…, { ignoreDuplicates: true })` (the app's retried upload) leaves one
  row; a client update of `extraction_status` fails with `42501`.
- `garmentRepository.int.test.ts` — `src/closet/garmentRepository.ts` signed in as a normal user:
  both photo variants upload (upsert) and the row is created as the upload queue does it,
  `listGarments` returns it newest first, `signedPhotoUrls` gives URLs that fetch the photo (HTTP
  200) and skips a missing one, a photo over the 2 MiB bucket limit throws `PermanentUploadError`,
  `bumpPhotoVersion` moves 1 → 2, `confirmReview` stamps `reviewed_at`, and `deleteGarment` leaves
  no row and no photos (and succeeds again on a retry). Uploads use `uploadGarmentPhotoBytes`, the
  storage half of `uploadGarmentPhoto`; its expo-file-system read is covered by the unit test.
- `extraction.int.test.ts` — attribute extraction end to end: A uploads
  `integration/fixtures/garment.webp` and inserts the row, the insert trigger calls the
  `extract-attributes` Edge Function through pg_net, and the function calls the mock Claude below.
  Claude's `ok` fixture gives `done` with its category within 20 s; a 500 or a refusal gives
  `failed`; a Claude that never answers gives `failed` within 40 s (the function's 30 s timeout);
  inserting the same id again makes no second Claude call; and a user whose daily quota is already
  used up (100 `consume_quota` calls through the service-role client) gets `over_quota` with no
  Claude call. Needs the Edge Runtime, so the full `pnpm db:start` or `pnpm db:start:ci`.

Not part of `pnpm test` or CI's `quality`/`security`/`actions` jobs — only the `database` job runs
it, after starting Supabase. Run it manually with `pnpm db:start && pnpm env:local && pnpm test:int`
when touching auth, RLS, profile or garment persistence, or the extraction function; `--runInBand` because the suites share one
database and create/delete real `auth.users` rows.

`integration/mockAnthropic.ts` is the mock Claude: `startMockAnthropic(port = 54499)` serves
`POST /v1/messages` on `0.0.0.0` (the function calls it from inside a container, as
`http://host.docker.internal:54499`, the local `ANTHROPIC_BASE_URL` in `supabase/config.toml`).
`respondWith({ status, body })` or `respondWith({ hang: true })` sets the reply for every following
call; `calls()` counts the calls; `close()` also drops hung connections. Replies reuse the recorded
fixtures in `supabase/functions/_shared/__tests__/fixtures/`, so the real API is never called.
`integration/fixtures/garment.webp` is a 784 px, ~9 KB WebP of a garment silhouette, encoded once
with sharp from `scripts/perf-fixtures.ts`'s `fixtureSvg` and committed.

Function logs (one line per call: the garment id and an outcome word) are in
`docker logs supabase_edge_runtime_dressing-room-app`; pg_net's view of each call is in
`net._http_response` (a `timed_out` row is expected for the hang case, since pg_net stops waiting
after 5 s while the function carries on).

`integration/lib-supabase.stub.ts` is mapped (via `jest.config.ts`'s `moduleNameMapper`) over
`src/lib/supabase.ts` for this project only: `emailAuth.ts`/`socialAuth.ts` default their `client`
parameter to the real Supabase singleton, which imports `react-native` and
`expo-sqlite/localStorage/install` — native modules that cannot load under plain Node. Every
integration test passes an explicit client built by `integration/helpers.ts` (`anonClient()` /
`serviceClient()`), so the default-client path is never meant to run here; the stub throws loudly if
it ever does. `integration/expo-file-system.stub.ts` is mapped over `expo-file-system` the same
way, since `garmentRepository.ts` imports its native-only `File`.

## pgTAP (`supabase/tests/*.test.sql`)

Run via `pnpm db:test` (`supabase test db`). Each file wraps its assertions in
`begin; select plan(N); ... select * from finish(); rollback;`, so nothing persists:

- `profiles_rls.test.sql` — cross-user isolation at the SQL level, no client inserts or deletes,
  and no anon access.
- `storage_rls.test.sql` — the `garments` bucket's configuration and the same cross-user isolation
  for `storage.objects`.
- `profiles_constraints.test.sql` — every CHECK constraint on `public.profiles` rejects an
  out-of-range or malformed value and accepts a fully valid row.
- `profiles_onboarding_clock.test.sql` — `onboarding_completed_at` is stamped from the server clock,
  not whatever the client sent.
- `profiles_write_rules.test.sql` — `created_at` can't be changed by a client update.
- `garments_rls.test.sql` — `public.garments`: each user sees, inserts, updates and deletes only
  their own rows; anon has no access.
- `garments_rules.test.sql` — the garments CHECKs (formality, warmth, colors, photo version) and
  the column grants: a client inserts only `id` and its own `user_id`, and never updates
  `extraction_status`, `wear_count` or `user_id`; `updated_at` moves on update.
- `usage_quota.test.sql` — `consume_quota()`'s per-user, per-day counter and its limit, and that
  clients can neither call it nor read `usage_counters`.
- `garment_extraction_trigger.test.sql` — the garments insert trigger's shape and privileges, the
  pg_net request it queues, and that an insert still succeeds with the Vault secrets missing or when
  queueing the request fails.

See `docs/database.md` for how these tests impersonate a user and create test rows without a real
JWT.

## Which tests need Docker

| Command        | Needs Docker (local Supabase) | Needs `.env.local` |
| --------------- | ------------------------------ | -------------------- |
| `pnpm test`     | no                              | no                    |
| `pnpm db:test`  | yes                             | no (connects directly) |
| `pnpm test:int` | yes                             | yes (`pnpm env:local` first) |

`pnpm typecheck`, `pnpm lint`, and `pnpm test` need nothing beyond `pnpm install`.

## Reading reset codes from Mailpit

Local email (signup confirmations — currently off; see `AGENTS.md` — and password-reset codes) is
caught by Mailpit instead of being sent, at `http://127.0.0.1:54424` (this repo's `+100` port
block). `integration/helpers.ts`'s `latestEmailCode(email)`:

1. Polls `GET /api/v1/messages` (up to ~2s, every 200ms) for the newest message addressed to
   `email`, since `resetPasswordForEmail`'s response can resolve a beat before Mailpit has recorded
   the message.
2. Fetches that message's body with `GET /api/v1/message/{ID}`.
3. Extracts the 6-digit code from the body with `/\b\d{6}\b/`.

NOTE: the local stack allows `[auth.rate_limit].email_sent = 2` emails per hour. `requestPasswordReset`
reports `over_email_send_rate_limit` as success (a code was already sent), and GoTrue returns the
same code when that project-wide cap is reached, so past it a user is told a code is on its way
when none is. The integration session must set the email and SMTP/SES sending limits generously
for the hosted project.

To check a code by hand during manual testing, open `http://127.0.0.1:54424` in a browser while
`pnpm db:start` is running and read the message body directly — the reset email template
(`supabase/templates/recovery.html`) contains only `{{ .Token }}`, no link.

## Running everything locally, in order

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm db:start
pnpm db:test
pnpm env:local
pnpm test:int
pnpm db:stop
```

CI's `database` job (`.github/workflows/ci.yml`) runs the Docker-dependent steps in the same order,
on the same ports, since the config in `supabase/config.toml` applies in CI too (the stack runs
alone there, so there's no other local project to avoid colliding with). Two differences:

- It starts the lean stack, `pnpm db:start:ci` (no Studio, Realtime, analytics or image proxy).
  Mailpit stays up, since `test:int` reads reset codes from it, and so does the Edge Runtime, since
  `extraction.int.test.ts` runs the extraction function end to end.
- After `db:test` it regenerates the types and fails if they differ from the committed file
  (`pnpm db:types && git diff --exit-code src/lib/database.types.ts`), so a migration can't land
  without its `database.types.ts`.
