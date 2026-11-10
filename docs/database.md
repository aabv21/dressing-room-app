# Database: schema, RLS and storage

The local backend is Supabase (Postgres 17) run via `pnpm db:*` scripts (see `AGENTS.md`). This
document covers the `public.profiles` table, its enums, the signup trigger, row level security, and
the `garments` storage bucket. See `docs/testing.md` for how these are exercised by pgTAP and the
integration Jest project.

## Tables and enums

### `public.profiles`

One row per `auth.users` row (`user_id uuid primary key references auth.users on delete cascade`),
created automatically on signup — see [Signup trigger](#signup-trigger) below. Clients never insert
a profile row (there is no insert policy); it already exists by the time a session has a user, so
every client write is an update — see [Writing a profile](#writing-a-profile-update-never-a-partial-upsert).

| Column                     | Type                  | Notes                                                           |
| -------------------------- | --------------------- | ---------------------------------------------------------------- |
| `user_id`                  | `uuid primary key`    | FK to `auth.users.id`, `on delete cascade`                      |
| `clothing_type`            | `clothing_type`       | nullable                                                         |
| `body_type`                | `body_type`           | nullable                                                         |
| `height_cm`                | `smallint`            | nullable; CHECK 120–230                                          |
| `chest_cm`, `waist_cm`, `hips_cm` | `smallint`      | nullable; CHECK 40–200 each                                     |
| `top_size`, `bottom_size`, `shoe_size` | `text`     | nullable; CHECK 1–10 chars after `btrim`                        |
| `age_group`                | `age_group`           | nullable                                                         |
| `styles`                   | `style[]`             | `not null default '{}'`                                         |
| `occasions`                | `occasion[]`          | `not null default '{}'`                                         |
| `city_name`                | `text`                | nullable; CHECK 1–80 chars after `btrim`                         |
| `city_lat`                 | `double precision`    | nullable; CHECK -90–90; must be null iff `city_lon` is null      |
| `city_lon`                 | `double precision`    | nullable; CHECK -180–180; must be null iff `city_lat` is null    |
| `language`                 | `app_language`        | nullable; null means "follow the device"                        |
| `onboarding_completed_at`  | `timestamptz`         | nullable; CHECK requires `clothing_type` to be set when non-null |
| `created_at`, `updated_at` | `timestamptz`         | `not null default now()`; `updated_at` set and `created_at` kept by triggers on update |

### Enums (exact values)

- `clothing_type`: `feminine`, `masculine`, `everything`.
- `body_type`: `hourglass`, `pear`, `apple`, `rectangle`, `inverted_triangle`, `trapezoid`,
  `triangle`, `oval`. Silhouette sets (enforced client-side, not by a DB constraint): feminine
  `[hourglass, pear, apple, rectangle, inverted_triangle]`; masculine
  `[trapezoid, triangle, oval, rectangle, inverted_triangle]`; everything uses the feminine set.
- `age_group`: `under_18`, `18_24`, `25_34`, `35_44`, `45_54`, `55_plus`.
- `style`: `casual`, `elegant`, `minimalist`, `sporty`, `urban`, `bohemian`, `classic`.
- `occasion`: `office`, `university`, `going_out`, `home`, `event`, `sport`.
- `app_language`: `en`, `es`.

Weight is never collected — there is no column for it, by design (see the spec's privacy stance).

## RLS and storage rules

### `public.profiles`

RLS is enabled with two policies for `authenticated`, both comparing `user_id = (select auth.uid())`
(wrapped in `select` so Postgres evaluates it once per statement, not once per row):

- `profiles_select_own` — `select`
- `profiles_update_own` — `update`, with the check in both `using` and `with check`

**There is no insert policy** (the first migration had one; `20261107171540_profiles_value_limits_and_write_rules`
dropped it): the signup trigger creates every row, so a client insert — including the insert half
of an upsert — is rejected with `42501`. **There is no delete policy** either: account deletion is
not yet implemented, so a client delete removes nothing, and a profile row only goes away via
`on delete cascade` from `auth.users`. The `anon` role has no privileges on the table at all
(nothing reads profiles while signed out), and neither client role has `truncate`, `trigger` or
`references`.

### `storage.buckets` / `storage.objects` (`garments` bucket)

The `garments` bucket is created by SQL insert (not the dashboard), so it is reproducible from
migrations:

- `public = false` (private — every read goes through an authenticated request)
- `file_size_limit = 2097152` (2 MiB)
- `allowed_mime_types = ['image/webp', 'image/png', 'image/jpeg']`

Object paths are namespaced per user: `<user_id>/<anything>`. Four policies on `storage.objects`
(select, insert, update, delete) all require:

```sql
bucket_id = 'garments'
and (storage.foldername(name))[1] = (select auth.uid())::text
```

A user can never read, write, or delete another user's objects, even with a guessed path — the
folder-name check runs server-side on every request.

### Writing a profile: update, never a partial upsert

`saveProfile` sends `update … where user_id = <me>` with only the columns that changed, and treats
an update that reaches no row as an error. Never use an upsert for a partial patch: Postgres checks
an `INSERT … ON CONFLICT DO UPDATE`'s proposed insert row against every CHECK constraint *before* it
finds the conflict, and that row has only the patch's columns. Saving just `city_lat`, for example,
failed `profiles_city_lat_lon_pair_check` even though the stored row had both coordinates. The
client also sends the coordinates as a pair (both, or both null when the city is cleared) and each
style or occasion once. (Duplicates aren't blocked in the database: a CHECK can't contain a
subquery, and the helper function it would need would also be exposed as an RPC.)

`created_at` can't be rewritten either: `public.keep_created_at()` (`before update`) copies the old
value back over whatever an update sends.

### Signup trigger

`public.handle_new_user()` is `security definer` with `set search_path = ''` (every name inside it
is fully qualified — `public.profiles`, not `profiles`) so it cannot be tricked by a search_path
manipulation into writing to the wrong table. It runs `after insert on auth.users` and inserts a
bare `public.profiles` row (`user_id` only; every other column takes its default/null). The
`updated_at` trigger (`public.set_updated_at()`) is the same pattern, firing `before update on
public.profiles`.

### Onboarding completion clock

`public.stamp_onboarding_completed_at()` (migration `20261105120000_onboarding_completed_at_server_clock`)
fires `before insert or update of onboarding_completed_at on public.profiles`. When the column goes
from null to non-null it replaces whatever the client sent with `now()`, so the completion time
always comes from the server clock, never a device's. Once set, it keeps the old value: a later
write (another timestamp, or a null) cannot change it, so no client can move a finished profile
back into onboarding. The app's `completeOnboarding` sends Postgres's `'now'` literal and filters on
`onboarding_completed_at is null`.

NOTE: the trigger also blocks the service role, so an admin reset of onboarding (back to null) must
run with the trigger disabled: `set local session_replication_role = replica;` in the same
transaction as the `update` (as the table owner).

## New table checklist

Supabase's default privileges (`pg_default_acl`; `\ddp` in psql) grant `anon`, `authenticated` and
`service_role` every privilege on each new table and sequence in `public`, and `execute` on each new
function (on top of Postgres's own default `execute` for `public`). So a new table starts wide open
to the API until RLS and these revokes close it:

- `alter table … enable row level security`.
- Policies `to authenticated`, comparing against `(select auth.uid())` (not a bare `auth.uid()`).
  An `update` policy has both `using` and `with check`, so a row can't be moved to another user.
- No insert, update or delete policy the app doesn't need (a missing policy is a denial).
- `revoke all on <table> from anon` unless signed-out access is really needed.
- `revoke truncate, trigger, references on <table> from anon, authenticated`.
- `revoke execute on function <fn> from public, anon, authenticated` for every new function,
  including trigger functions (a trigger still fires; only direct calls are blocked).
- An index on the column per-user queries filter by (`user_id`), unless it's already the primary
  key.
- Tests: pgTAP for the policies and constraints, and supabase-js integration tests that user A
  can't select, update, delete or list user B's rows.
- `pnpm db:types` and commit the generated types (CI fails on drift).

## How to add a migration

```bash
pnpm exec supabase migration new <descriptive_name>
```

This writes an empty, timestamped file under `supabase/migrations/`. Write plain SQL into it —
`create table`, `alter table`, new policies, etc. Then:

```bash
pnpm db:reset   # drops and recreates the local DB from every migration + supabase/seed.sql
pnpm db:test    # runs the pgTAP suite under supabase/tests/
pnpm db:types   # regenerates src/lib/database.types.ts — commit it alongside the migration
```

**Migrations are append-only once merged.** Never edit a migration file that has already landed on
`main` — even to fix a typo. Write a new migration that corrects it instead. This keeps
`pnpm db:reset` reproducible for every other clone of the repo (and for CI) at every point in
history, and avoids a merged migration's hash diverging from what's already been applied to any
running database.

## pgTAP tests

`supabase/tests/*.test.sql` run under `pg_prove` via `pnpm db:test`. Each file wraps its assertions
in `begin; select plan(N); ... select * from finish(); rollback;` so nothing it does persists. pgTAP
is not installed by default in the local Postgres image; rather than ship it as a migration (which
would install its ~1000 functions into every environment, including the hosted database), each test
file enables it for itself as its first statement after `begin;`
(`create extension if not exists pgtap with schema extensions;`) and the closing `rollback;` removes
it again. `supabase test db` (CLI 2.122.0) also manages this on its own, so the per-file statement
is a belt-and-suspenders guard, not the only thing making pgtap available.

Tests impersonate a user without needing a real JWT, by setting the two GUCs PostgREST reads:

```sql
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
```

(`set local ... = <expression>` is not valid SQL for a non-literal value — `SET` only accepts
literals — hence `set_config()`, which accepts any text expression, with `is_local = true` to
scope it to the transaction like `set local` would.)

Test users are created by inserting directly into `auth.users` with explicit, fixed UUIDs inside
the test transaction; the insert fires the signup trigger, and the rollback at the end of the file
discards both the user and its profile row — no cleanup step is needed.

- `profiles_rls.test.sql` — cross-user isolation: A sees only A's row, A's update targeting B's row
  changes nothing, A can't insert (for anyone, nor upsert their own row), A's delete of their own
  row removes nothing, and the anon role can't read the table at all.
- `storage_rls.test.sql` — bucket configuration (private, 2 MiB, three MIME types) plus the same
  cross-user isolation for `storage.objects`.
- `profiles_constraints.test.sql` — every CHECK constraint rejects an out-of-range or malformed
  value (`height_cm = 300`, `waist_cm = 10`, an 11-character `top_size`, an 81-character or blank
  `city_name`, `city_lat` without `city_lon`, onboarding completed with a null `clothing_type`) and
  accepts a fully valid row; updating one coordinate of a stored pair passes.
- `profiles_onboarding_clock.test.sql` — completing onboarding (by update, or by an insert as the
  table owner) stores the server's `now()`, not the client-sent time; a second completion or a null
  keeps the original time.
- `profiles_write_rules.test.sql` — a client update can't change `created_at`.

See `docs/testing.md` for how this suite fits alongside the Jest projects, and which commands need
Docker.

## Local backup and restore

Not exercised by CI or the automated test suites — this is a manual procedure for local
development. Dump **outside the repo** — a local DB dump can contain real account data from manual
testing and must never land in git history:

```bash
pnpm exec supabase db dump --local -f ~/dressing-room-backup.sql   # schema + data, local DB only
```

To restore into a fresh local stack: `pnpm db:reset` (migrations + seed) and then replay any data
you need from the dump with `psql "$SUPABASE_DB_URL" -f ~/dressing-room-backup.sql`, or pass
`--data-only` to `db dump` if you only want rows back on top of an already-migrated schema. This is
a local convenience, not a production backup strategy — Supabase Cloud projects get point-in-time
recovery from the platform itself.
