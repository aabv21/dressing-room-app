# Testing

Three Jest projects, one pgTAP suite. `pnpm test` runs the two that need no Docker; `pnpm test:int`
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

### `scripts`

Tests for `scripts/**/*.test.ts` (repo tooling, e.g. `scripts/env-local.ts`), running under plain
Node — no Expo globals, no React Native. Kept out of the `app` project because `jest-expo`'s preset
installs lazy globals (`fetch`, `structuredClone`, …) that conflict with a `scripts` test file's own
`@jest-environment node` docblock during teardown.

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

Not part of `pnpm test` or CI's `quality`/`security`/`actions` jobs — only the `database` job runs
it, after starting Supabase. Run it manually with `pnpm db:start && pnpm env:local && pnpm test:int`
when touching auth, RLS, or profile persistence; `--runInBand` because the suites share one
database and create/delete real `auth.users` rows.

`integration/lib-supabase.stub.ts` is mapped (via `jest.config.ts`'s `moduleNameMapper`) over
`src/lib/supabase.ts` for this project only: `emailAuth.ts`/`socialAuth.ts` default their `client`
parameter to the real Supabase singleton, which imports `react-native` and
`expo-sqlite/localStorage/install` — native modules that cannot load under plain Node. Every
integration test passes an explicit client built by `integration/helpers.ts` (`anonClient()` /
`serviceClient()`), so the default-client path is never meant to run here; the stub throws loudly if
it ever does.

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

- It starts the lean stack, `pnpm db:start:ci` (no Studio, Realtime, Edge Runtime, analytics or
  image proxy). Mailpit stays up, since `test:int` reads reset codes from it.
- After `db:test` it regenerates the types and fails if they differ from the committed file
  (`pnpm db:types && git diff --exit-code src/lib/database.types.ts`), so a migration can't land
  without its `database.types.ts`.
