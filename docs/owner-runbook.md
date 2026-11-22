# Owner runbook

The steps that need the owner's accounts or hardware, in order, each with its status. Everything
else in this repo runs offline ([`testing.md`](testing.md)). Statuses are as of 2026-11-21; update a
step's status and date when it changes.

**Status words:** Done, Pending (not started or not finished), Blocked (waiting on someone else).

## Decisions on record

- **The app identity is final:** display name "Dressing Room", slug `dressing-room-app`, scheme
  `dressingroom`, bundle id and Android package `com.aabv21.dressingroom`.
- **Hosted project:** Supabase project ref `lkmolwiywnnmzmsarjmb`, free plan.
- **EAS project:** `@aabv211996/dressing-room-app` (`app.json`'s `owner` and `extra.eas.projectId`).
- **Email sender:** Brevo's SMTP relay, from `hello.aabv21@gmail.com` as "Dressing Room".
- **The family installs the Android preview APK** (EAS `preview` profile), which talks to the hosted
  project without Metro.
- **Hosted secrets are set from an empty directory**, never from this repo (see
  [Setting a hosted secret](#setting-a-hosted-secret)).
- **Nothing is deployed before the owner merges:** migrations, functions and builds go to the hosted
  project only from merged code.

## Setting a hosted secret

Never run `supabase secrets set` or `unset` for the hosted project from this repo. With
`supabase/config.toml` in the working directory, the CLI (seen with 2.122.1) also pushes every
`[edge_runtime.secrets]` value: the local fake keys, the made-up `APPLE_*` ids and the
`host.docker.internal` mock URLs, which would send hosted Claude, Jev, Open-Meteo and Apple calls
nowhere. Run it from an empty directory with the repo's binary, reading values with `read -s` so they
stay out of the shell history:

```bash
cd "$(mktemp -d)" && ~/…/dressing-room-app/node_modules/.bin/supabase secrets set \
  --project-ref lkmolwiywnnmzmsarjmb NAME=value
```

Afterwards `secrets list` must show no `*_BASE_URL` or `OPEN_METEO_*` secret, and the `APPLE_*`
ids only once they're the real ones. With the base URLs unset, the functions call the real hosts
([`api.md`](api.md#outside-providers-and-their-local-mocks)).

## 1. App name and bundle id

**Status: Done.** `com.aabv21.dressingroom` is final. Changing it now would mean redoing `eas
init`, the OAuth clients and the store records.

## 2. Hosted project

**Status: Done (2026-11-21).**

- **Done.** Create the project, then `pnpm exec supabase login`,
  `pnpm exec supabase link --project-ref lkmolwiywnnmzmsarjmb`, `pnpm exec supabase db push` and
  `pnpm exec supabase functions deploy` (no name deploys all eight; each keeps its `verify_jwt` from
  `config.toml`, so `extract-attributes` stays `false` and the other seven `true`).
  `supabase/seed.sql` is local only.
- **Done.** Wave 1 (#45) is deployed: its migration `20261120120000_quota_local_day.sql` and the
  functions that send the local day to `consume_quota`.
- **Pending (after merge).** Wave 5a-2 (saved outfits and suggestion feedback), in this order:
  1. `pnpm exec supabase db push` for `20261121120000_suggestion_feedback.sql`
     (`dismissed_outfits`, `garments.suggest`, `outfits.score`, the new `save_outfit` signature and
     the saved-outfit delete policy);
  2. `pnpm exec supabase functions deploy lucky-list for-you rate-outfit export-data`;
  3. then the app build.

  Incompatible combinations:
  - New functions on the old schema: every garment read selects `wear_count` and `suggest`, so
    lucky-list, for-you and rate-outfit answer 500, and lucky-list also reads `dismissed_outfits`.
  - The new app before the new `export-data`: the app refuses an export without `dismissedOutfits`
    ("Export my data" fails).
  - The new app on the old schema: Saved, "Not for me", the suggestions switch, Profile's restore
    and Save with a score all fail.
  - An old app on the new schema and functions works: `save_outfit` still takes the garment ids
    alone, and old builds never send `suggest`.
- **Pending (after merge).** Wave 5a-3 (price and cost per wear, stores by country, sharing an
  outfit image), after 5a-2 and in this order:
  1. `pnpm exec supabase db push` for `20261121130000_garment_price.sql` (`garments.price` and
     `garments.currency`, their checks and column grants);
  2. `pnpm exec supabase functions deploy export-data` (its garment read is `select=*`, so its code
     doesn't change; this makes sure the deployed one is 5a-2's and reads the new columns);
  3. then a new app build (EAS `preview` for the family's APK, and the store profiles when they're
     set up): the wave adds a native module, `react-native-view-shot`, so a JavaScript-only reload
     of an older build can't run it.

  Incompatible combinations:
  - The new app on the old schema: saving a price fails ("Couldn't save"), and nothing else does;
    the closet still loads, since it selects `*`.
  - An old app on the new schema works: it never sends a price, and unpriced rows read as before.
- **Pending (after merge).** Wave 5a-4 (the daily reminder, listen and dictate), after 5a-3: no
  migration and no function deploy, only a new app build (EAS `preview`, and the store profiles
  when they're set up). It adds native modules (`expo-notifications`, `expo-speech`, `expo-speech-recognition`), so
  a JavaScript-only reload of an older build can't run it, and it changes the microphone
  permission, so a local build must start from a clean prebuild (`pnpm expo prebuild --clean`, or
  delete `ios/` and `android/` first): the old `AndroidManifest.xml` still blocks `RECORD_AUDIO`
  with `tools:node="remove"`, and a plain `pnpm android` keeps it. EAS builds prebuild from scratch.
  The on-device checks are in [section 5](#5-live-checks-on-the-phone).
- **Pending (after merge).** Wave 5b-1 (the outfit planner and trip packing), after 5a-4 and in
  this order:
  1. `pnpm exec supabase db push` for `20261122120000_planner_trips.sql` (`planned_outfits` with
     `plan_outfit`, `saved_trips`, the server-only `trip_cache`, the `trip` quota kind and
     `prune_expired_caches()` with `trip_cache`'s 7-hour line);
  2. `pnpm exec supabase functions deploy trip-plan export-data` (`trip-plan` is new and needs no
     secret beyond the defaults: Open-Meteo has no key; `export-data` adds plans and saved trips);
  3. then the app build (EAS `preview`, and the store profiles when they're set up). No native
     module is added, but the planner and trip screens are new routes.

  Incompatible combinations:
  - The new functions on the old schema: `trip-plan` answers 500 (no `trip` quota kind or
    `trip_cache`) and `export-data` answers 500 (no `planned_outfits`).
  - The new app before the new `export-data`: the app refuses an export without `plannedOutfits`
    and `savedTrips` ("Export my data" fails).
  - The new app before `trip-plan` is deployed: "Pack for a trip" says something went wrong; the
    planner on the old schema can't save.
  - An old app on the new schema and functions works: nothing it calls changed shape.
- **Pending (after merge).** Wave 5b-2 ("Should I buy it?"), after 5b-1 and in this order:
  1. `pnpm exec supabase db push` for `20261123120000_buy_check_quota.sql` (the `buy_check` quota
     kind);
  2. `pnpm exec supabase functions deploy buy-check` (new; it reads the same `ANTHROPIC_API_KEY` as
     `extract-attributes`, so no new secret, and keeps `verify_jwt = true` from `config.toml`);
  3. then the app build (EAS `preview`, and the store profiles when they're set up). No native
     module is added (`expo-image-picker`'s camera was already in the build), but the screen is a new
     route.

  Incompatible combinations:
  - `buy-check` on the old schema: every check answers 500 (no `buy_check` quota kind), before
    Claude is called.
  - The new app before `buy-check` is deployed: "Should I buy it?" says something went wrong.
  - An old app on the new schema and function works: nothing it calls changed.
- **Pending (after merge).** Wave 5b-3 ("Ask your stylist"), after 5b-2 and in this order:
  1. `pnpm exec supabase db push` for `20261124120000_stylist_quota.sql` (the `stylist` quota kind);
  2. `pnpm exec supabase functions deploy stylist` (new; it reads the same `ANTHROPIC_API_KEY` as
     `extract-attributes` and the Open-Meteo defaults, so no new secret, and keeps
     `verify_jwt = true` from `config.toml`);
  3. then the app build (EAS `preview`, and the store profiles when they're set up). No native
     module is added (dictation and Listen were already in the build), but the screen is a new route
     and the microphone and speech recognition purpose strings now name the stylist, so build from a
     clean prebuild.

  Incompatible combinations:
  - `stylist` on the old schema: every message answers 500 (no `stylist` quota kind), before Claude
    is called.
  - The new app before `stylist` is deployed: "Ask your stylist" says something went wrong.
  - An old app on the new schema and function works: nothing it calls changed.
- **Done.** Keep the free project awake: the repository variables `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` (`gh variable set …`) feed the daily `.github/workflows/keepalive.yml`; a
  manual `gh workflow run keepalive.yml` answers the server time from `public.keep_alive()`. GitHub
  stops scheduled workflows after 60 days without repository activity (it emails first).
- **Done.** Mirror `config.toml`'s Auth settings in the dashboard: `minimum_password_length` 8;
  "No required characters" (the app checks only the length); email OTP length 6 (the dashboard's
  default is 8, and the reset screen takes exactly 6 digits); Site URL `dressingroom://`; and
  `skip_nonce_check` on the Google provider.

## 3. Secrets, keys and spend caps

**Status (2026-11-21): Blocked on Apple; Pending: the TypeSafe rate-limit check and the sign-up decision; the rest Done.**

- **Done.** Hosted secrets: the Vault secrets `extract_attributes_url` (the deployed
  `extract-attributes` URL) and `extract_webhook_secret` (a random secret), and the function secrets
  `EXTRACT_WEBHOOK_SECRET` (the same secret), `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY`:

  ```sql
  select vault.create_secret('https://lkmolwiywnnmzmsarjmb.supabase.co/functions/v1/extract-attributes', 'extract_attributes_url');
  select vault.create_secret('<random secret, e.g. openssl rand -hex 32>', 'extract_webhook_secret');
  ```

  Without them hosted garments reach review with empty fields, and the outfit functions answer 500
  (`index.ts` requires `TYPESAFE_API_KEY`; `rate-outfit` and `for-you` also `ANTHROPIC_API_KEY`).
- **Pending.** TypeSafe rate limits: check them against a lucky list's up to 30 ratings (5 at once),
  a rating's up to 8 swap checks and For you's up to 10 fits (5 at once); a 429 from Jev looks like
  a failure.
- **Done (2026-11-17).** Spend caps: a monthly limit on the Anthropic organization. TypeSafe's
  console offers no spend limit or alert, so watch its usage by hand the first month
  ([`ai.md`](ai.md#quota-and-cost) assumes per-request billing). The quotas allow about $6 a month of Jev for 4 users at
  worst; typical use is about $0.65.
- **Blocked (Apple enrollment failed; ticket open with Apple).** Sign in with Apple and token
  revocation: create a Sign in with Apple key (a `.p8` file and its Key ID) for the bundle id, then
  [set](#setting-a-hosted-secret) `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (the bundle id)
  and `APPLE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' AuthKey_<key id>.p8)"` (the PEM on one line
  with literal `\n`s, which `_shared/apple.ts` reads like newlines). Leave `APPLE_BASE_URL` unset.
  Enable the hosted Apple provider with the bundle id as its client id. Until then `apple-token`
  answers `skipped` and account deletion can't revoke Apple; the iOS build and TestFlight wait on it
  too.
- **Done.** Google sign-in: a web and an iOS OAuth client in the Google Cloud project "Dressing
  Room", both listed in the hosted Google provider (web first), and an Android client for
  `com.aabv21.dressingroom` with the EAS keystore's SHA-1 (`eas credentials`). `app.json`'s
  `iosUrlScheme` is the iOS client's reversed id; the two ids are in `.env.example` and the EAS
  environments. Without a client matching the package and SHA-1, Google answers `DEVELOPER_ERROR`.
  - **Pending.** An Android client for the debug keystore's SHA-1, only for Google sign-in in local
    `pnpm expo run:android` builds.
  - **Pending.** An Android client for Play App Signing's SHA-1, once the app is on Play.
- **Done.** Email sender (Brevo): sender "Dressing Room" `hello.aabv21@gmail.com`, an SMTP key
  named for the app, custom SMTP in the hosted Auth settings (`smtp-relay.brevo.com`, port `587`,
  Brevo's SMTP login as the username, the key as the password), the **Reset password** template
  (subject `Your Dressing Room reset code`, body `supabase/templates/recovery.html`), and the Auth
  email rate limit at 30 an hour. NOTE: a `@gmail.com` sender can't pass DMARC alignment, so some
  messages land in spam; upgrade path: an owned domain authenticated in Brevo (DKIM, DMARC) or moved
  to Resend, changing only the four SMTP fields and the sender.
- **Pending (owner decision).** Hosted sign-up hardening: email confirmation, a CAPTCHA, or closing
  sign-ups once the household's accounts exist ([`red-team.md`](red-team.md#parked)). Each new
  account gets its own daily AI quotas.

## 4. EAS project and builds

**Status: Done (2026-11-21).**

- **Done.** `eas init` wrote `app.json`'s `extra.eas.projectId` and `owner`. NOTE: it also writes
  the plugins' resolved config into `app.json`; keep only those two keys, since prebuild generates
  the rest.
- **Done.** EAS environment variables, for `preview` and `production`, with `--visibility
  plaintext` (they're public, inlined into the bundle): `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`:

  ```bash
  pnpm dlx eas-cli@27 env:set --name EXPO_PUBLIC_SUPABASE_URL \
    --value https://lkmolwiywnnmzmsarjmb.supabase.co --visibility plaintext \
    --environment preview --environment production
  ```

  and the same for the other three; check with `eas env:list --environment production`. A cloud
  build without them crashes at launch (`src/lib/supabase.ts` throws on a missing URL or key).
- **Done.** The Android preview APK (`pnpm dlx eas-cli@27 build -p android --profile preview`), the
  family's install path.
- **As needed.** Local builds after a native change: `pnpm expo run:ios` / `pnpm expo run:android`
  (there is no EAS development profile and no `expo-dev-client`).

## 5. Live checks on the phone

**Status: Pending.** On the preview APK (and an iPhone once Apple is unblocked), against the hosted
project:

- **Pending.** The on-device performance gate ([`performance-gate.md`](performance-gate.md)), on an
  iPhone first and then a family Android phone, including the drag-without-momentum check; then fill
  in that doc's results and the README's status line.
- **Pending.** The Spanish category and color names in the app (Closet chips, review, garment
  detail); fix any that read oddly in `src/i18n/es.ts`.
- **Pending.** The cache cleanup job: `select status, return_message from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'prune-expired-caches') order by
  start_time desc limit 1;` shows `succeeded`.
- **Pending.** Live Open-Meteo: Today shows the day's weather for a real city and `weather_cache`
  gets the hour's row; also a city typed without coordinates.
- **Pending.** Live Claude: upload a few garments and check the attributes and doubted fields; a
  slow extraction (over 5 s) still lands, since pg_net stops waiting while the function carries on.
- **Pending.** Live For you lines in English and Spanish (a closet change or the next day between
  them): the profile's language, at most 90 characters, no brand, store or price, no repeated
  numbers.
- **Pending.** A photo carrying printed instructions ([`red-team.md`](red-team.md#live-checks-owner-session)).
- **Pending.** `garment-cutout` on a real iPhone (the simulator can't run Vision's mask) and a real
  Android phone (the first cut-out right after install, while ML Kit's model may be downloading,
  and a portrait-EXIF photo coming out upright); the WebP alpha once on a real phone; photos without
  a cut-out stay upright.
- **Pending.** The burst camera on both platforms: the localized permission prompt, several shots,
  Done, and the Discard / Keep shooting confirm on close and on Android's back gesture.
- **Pending.** Offline for over an hour: the closet still shows photos from expo-image's disk cache
  after the signed URLs expire.
- **Pending.** The outfit screens by touch: Today's "Another", "I'll wear it" and occasion chips;
  Build through "How does it look?"; the rating's swap, Save, "I'll wear it" and "Missing
  something?"; For you's "Search in stores".
- **Pending.** The daily reminder on both platforms: turn it on in Profile (the system prompt
  appears once; on Android 13+ too), set it 2–3 minutes ahead and lock the phone; the notification
  arrives in the app language and tapping it opens Today (also with the app closed). Change the
  time and check that only the new one arrives; switch the language and check the copy follows;
  sign out and check nothing arrives. Deny the permission once: the explanation and "Open settings"
  show, and turning notifications on there lets the switch work. On Android, check the status-bar
  icon renders as the monochrome app outline, not a white square.
- **Pending.** Listen in both languages, on an iPhone (silent mode off) and an Android phone: on
  Today, the rating and For you, the voice reads the outfit, the score and reasons, and the idea in
  English, then again with the app in Spanish (a Latin American voice where installed); a second
  tap stops it, and so does switching tabs mid-sentence; Listen on another card takes over. With
  no Spanish voice installed (Android: remove it in the TTS settings), the button hides or says so.
- **Pending.** Dictation in both languages: the city modal's mic (the microphone prompt, and on
  iOS the speech recognition prompt, in the app's language) fills the field with a spoken city;
  Today's "Say the occasion" picks Oficina for "trabajo" (Office for "work" in English), Salidas
  for "fiesta", Deporte for "gimnasio", and says it didn't catch something unrelated. On an iPhone in airplane mode it
  still works for a language with on-device support; on Android check it once with the Google app
  or Speech Services installed. Deny the microphone once and check the message.
- **Pending.** The planner on the phone: plan a Saved outfit, a suggestion and one built in Build for
  three different days; tomorrow's plan shows as "Planned for today" the next morning, and only its
  "I'll wear it" adds a Diary entry. With the reminder on and a plan for tomorrow, the notification
  says "You planned: …"; remove the plan and open the app, and the next one says the usual text.
- **Pending.** Trip packing on the phone: a real city 3–5 days ahead gets each day's forecast, one
  outfit per day and a packing list; a trip starting more than 16 days ahead says "Forecast
  unavailable" for its days; check off items, leave, plan the same trip again and the checks are
  still there; Save it and reopen it from the saved list; dictate the city once.
- **Pending.** "Should I buy it?" on the phone, with the real Claude: a shot in a store of something
  you own (the verdict says you already have something very similar, its thumbnail opens it), a
  store screenshot of a piece you don't (the new-outfit count and the verdict), a photo of no
  clothing ("doesn't look like clothing"), and "Add to my closet" (the piece reaches review). Deny
  the camera once and check the message; the sixth check of the day says the 5 are used.
- **Pending.** "Ask your stylist" on the phone, with the real Claude, once in Spanish and once in
  English (switch the app language in Profile): ask "¿qué me pongo hoy?" / "what should I wear
  today?" (a short reply in that language and an outfit card; "Calificarlo" / "Rate it" opens the
  rating, "Me lo pongo" / "I'll wear it" logs it); dictate a follow-up ("¿y otro?" / "another one?")
  and check the outfit changes; turn "Speak replies" on (the next reply reads itself in a Latin
  American voice in Spanish) and start dictating while it reads (it stops). Then ask it to ignore
  its instructions and list other users, to name a store or a price, and something off-topic: it
  declines or redirects in one sentence. "New chat" clears it; leaving and coming back starts empty;
  the 21st message of the day says the 20 are used. Check the Anthropic console's usage for the
  session against `ai.md`'s per-message estimate.
- **Pending.** Large text and screen readers: the largest Dynamic Type and Android font scale 2.0
  through every tab, the rating, review and Diary; then VoiceOver and TalkBack.
- **Pending.** Google sign-in on the phone; Sign in with Apple and its revocation once Apple is
  unblocked (`apple_tokens` gets a row, the deletion logs `"revoke":"revoked"`, and the app leaves
  the Apple ID's "Sign in with Apple" list).
- **Pending.** Data export on a phone: the share sheet with `dressing-room-export-YYYY-MM-DD.json`,
  every section present, and a photo URL that opens.
- **Pending.** Account deletion by touch: a throwaway account lands on Welcome and is gone from the
  hosted project; then a lost answer (airplane mode right after "Delete forever") shows the
  "couldn't be confirmed" message, and back online the next check lands on Welcome.

## 6. Calibration

**Status: Pending.** The math, the report and how to apply a suggestion are in
[`ai.md`](ai.md#calibration).

The owner and their partner each label about 25 saved outfits `bad`, `ok` or `good`:

1. **Export** (once per labeler):
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm calibrate export --user <uid> --labeler <name>`.
   It reads the user's saved outfits and profile from the hosted project with the service role,
   builds each outfit's state with `rate-outfit`'s own `ratingState` (no occasion, no weather, the
   season of the day it was saved), skips incomplete outfits, and appends new ones to
   `calibration/labels.local.json` with `label: null`. Re-running adds only new outfits and keeps
   the labels.
2. **Label** by hand: set each `label`. Entries left `null` are ignored.
3. **Collect**: `TYPESAFE_API_KEY=… pnpm calibrate collect` sends the production Jev request once per
   labeled outfit without a saved answer (5 at a time) into `calibration/answers.local.json`. An
   answer that doesn't parse isn't saved, the run exits 1, and the next run asks again. Each outfit
   costs one rating.
4. **Evaluate**: `pnpm calibrate eval` prints the Markdown report and exits 0; it writes nothing.

Both `.local.json` files hold personal data: gitignored, owner-readable only, never committed. A
dry run on the fictional examples:
`pnpm calibrate eval --labels calibration/example.labels.json --answers calibration/example.answers.json`.

- **Pending.** Apply the suggested weights, bands and confidence aggregate only if they clearly
  improve agreement.
- **Pending.** Watch how often Jev answers `none` for the weakest piece; TypeSafe's Choice docs warn
  that a "none of the above" option may work poorly.

## 7. Backups

**Status: Pending.** The scheduled backup, then one restore of the hosted dump.

The free tier has no downloadable backups, so the owner's Mac takes one every night with
`pnpm backup` (`scripts/backup.ts`) under launchd. Backups hold real family data: they go only to
`~/dressing-room-backups/`, never into this repository or GitHub. `BACKUP_DIR` must be a folder of
its own: the script refuses one inside the repository, the home folder and the filesystem root,
since each run tightens the folder to `0700`.

### What a backup holds

Each run writes `~/dressing-room-backups/<UTC time>/`, for example `2026-11-09T03-30-00Z/`:

- `schema.sql`: `pnpm exec supabase db dump --db-url <BACKUP_DB_URL without its password>`, with the
  password in `PGPASSWORD`: the schema of `public` at backup time.
- `data.sql`: the same with `--data-only --use-copy`: the rows of `public`, `auth` (users,
  identities, sessions) and `storage.objects`. It leaves out `storage.buckets` (the bucket row comes
  from a migration), Storage's vector tables, pg_net's queue and responses, and the `cron` schema (the
  CLI's data dump skips it), so a restore never collides with the `prune-expired-caches` job. The
  dump starts with `SET session_replication_role = replica`, so no trigger fires on restore.
- `garments/<user id>/<garment id>/{full,thumb}.webp`: every object in the bucket, downloaded with
  the service role.
- `manifest.json`: `createdAt`, plus each file's `path`, `size` and `sha256`.

A backup is credential material: `auth.users` holds bcrypt password hashes, `auth.sessions` and
`auth.refresh_tokens` hold live refresh tokens, and `public.apple_tokens` holds Apple refresh tokens.
Every file is `0600` and every folder `0700` (the script runs under `umask 077`, the plist sets
`Umask` 63). Keep FileVault on, and back up to an encrypted Time Machine disk or exclude the folder
with `tmutil addexclusion ~/dressing-room-backups`.

A run writes into `<UTC time>.partial/` and renames it only once every step succeeded, then keeps
the newest 14 complete backups. A failed step exits 1 and leaves the `.partial` folder; no new
download starts after the first failure, and no complete backup is deleted. Each run deletes
`.partial` folders more than 7 days old and logs the newest complete backup's name and age. The log
has outcome words only; the database URL, its password and the service-role key are redacted, and
the password never reaches a command line.

The backup doesn't hold the Vault secrets or the function secrets; set them again by hand after a
restore to a new hosted project.

### Setup (owner's Mac)

- **Pending.** The dump runs `pg_dump` in Docker, so OrbStack must be running at 03:30: set it to
  open at login.
- **Pending.** Put the settings in a file only you can read, outside the repo, for example
  `~/.config/dressing-room/backup.env` (`chmod 600`):

  ```bash
  BACKUP_DB_URL=postgresql://postgres.lkmolwiywnnmzmsarjmb:<percent-encoded password>@<pooler host>:5432/postgres
  SUPABASE_URL=https://lkmolwiywnnmzmsarjmb.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<service-role key>
  # BACKUP_DIR=~/dressing-room-backups   (the default)
  ```

  `BACKUP_DB_URL` is the session pooler's string (Dashboard → Connect → Session pooler), since the
  free tier's direct connection is IPv6 only. Percent-encode the password (`@` as `%40`, `%` as
  `%25`, `/` as `%2F`); a URL that doesn't parse is refused with that hint and never echoed.
- **Pending.** Run it once by hand:
  `node --env-file="$HOME/.config/dressing-room/backup.env" scripts/backup.ts`. It prints
  `backup: complete <UTC time>`.
- **Pending.** Schedule it: copy `scripts/launchd/com.aabv21.dressing-room-backup.plist.example` to
  `~/Library/LaunchAgents/com.aabv21.dressing-room-backup.plist`, replace the `/ABSOLUTE/PATH`
  placeholders, use a stable `node` path (not a per-shell fnm path), and put `node`, `pnpm` and
  `docker` on the plist's `PATH`. Then:

  ```bash
  plutil -lint ~/Library/LaunchAgents/com.aabv21.dressing-room-backup.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aabv21.dressing-room-backup.plist
  launchctl kickstart -p gui/$(id -u)/com.aabv21.dressing-room-backup   # one run now
  tail ~/Library/Logs/dressing-room-backup.log
  ```

  The job runs at 03:30 every day, or when the Mac wakes. The log must end in `backup: complete`,
  and `manifest.json` must list every photo. If it shows `EPERM` or `Operation not permitted` for
  the repository path, macOS blocks launchd's `node` from `~/Documents`: give that `node` Full Disk
  Access, or run the job from a clone outside `~/Documents`.

### Restore

- **Pending.** Restore the newest hosted backup once into a fresh local stack and compare the row
  counts with the hosted project. The scripted check has only run against the local stack.

Restore into a database that already has the migrations: a fresh local stack (`pnpm db:reset`), or a
new hosted project after `supabase link` and `supabase db push`. `schema.sql` is the record of the
schema at backup time; compare it with the migrations, don't apply it on top of them.

You need `psql` (`brew install libpq`, keg-only, so put `$(brew --prefix libpq)/bin` on `PATH`). For a
local target without it, run `docker exec -i supabase_db_dressing-room-app psql -U postgres -d
postgres --single-transaction --variable ON_ERROR_STOP=1 --quiet < "$BACKUP/data.sql"` instead of
step 2.

No secret goes on a command line: `psql` reads the password from `PGPASSWORD`, `curl` reads the key
headers from stdin (`-K-`), and `printf` is a shell builtin. Steps 1 to 3 are chained with `&&`. Run
this from the repository root, in zsh or bash:

```bash
BACKUP=~/dressing-room-backups/<UTC time>
TARGET_DB_URL='postgresql://postgres.<ref>@<pooler host>:5432/postgres'   # no password in it
SUPABASE_URL='https://<ref>.supabase.co'
read -rs PGPASSWORD && export PGPASSWORD   # the target database's password
read -rs SERVICE_KEY                       # the target's service-role key

# 1. Check the backup first: every size and sha256 in manifest.json.
# 2. The rows, in one transaction. Any error rolls the whole restore back.
# 3. The photos. data.sql already restored their storage.objects rows; this uploads the bytes over
#    them, and stops at the first upload that fails.
# Each step runs only if the one before it succeeded.
node scripts/backup.ts --verify "$BACKUP" &&
  psql --single-transaction --variable ON_ERROR_STOP=1 --quiet \
    --dbname "$TARGET_DB_URL" --file "$BACKUP/data.sql" &&
  (cd "$BACKUP/garments" && find . -type f -print0 | while IFS= read -r -d '' f; do
    printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SERVICE_KEY" "$SERVICE_KEY" |
      curl -K- -fsS -o /dev/null -X POST -H 'x-upsert: true' -H 'content-type: image/webp' \
        --data-binary "@$f" "$SUPABASE_URL/storage/v1/object/garments/${f#./}" ||
      { echo "photo upload failed: ${f#./}" >&2; exit 1; }
  done) && echo 'restore complete'

# 4. Spot-check row counts against the source.
psql --dbname "$TARGET_DB_URL" -Atc "select 'auth.users', count(*) from auth.users
  union all select 'profiles', count(*) from public.profiles
  union all select 'garments', count(*) from public.garments
  union all select 'storage.objects', count(*) from storage.objects
  union all select 'outfits', count(*) from public.outfits
  union all select 'outfit_items', count(*) from public.outfit_items
  union all select 'wears', count(*) from public.wears
  union all select 'sum(wear_count)', coalesce(sum(wear_count), 0) from public.garments"
```

For a local target, `TARGET_DB_URL` is `postgresql://postgres@127.0.0.1:54422/postgres` with
`PGPASSWORD=postgres` (a local-only value), `SUPABASE_URL` is `http://127.0.0.1:54421`, and
`SERVICE_KEY` is `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`. On a hosted target, set the Vault and
function secrets again afterwards.

This procedure was tested against the local stack, as written, in zsh: two fictional `@example.com`
users with 6 garments, 12 photos, 2 outfits and 4 wears went through `pnpm backup`, `pnpm db:reset`
and steps 1 to 4. The counts and the content digests of `garments`, `profiles`, `wears`,
`auth.users` and `storage.objects` matched, every photo matched its sha256, and a restored user
signed in and read their 3 garments through RLS. A tampered photo failed step 1, a wrong upload URL
stopped step 3 at the first photo, and a stack with the `pg_cron` job kept its single job.

### Local dump

To keep a copy of the local database while developing, run the same script against the local stack,
with a `BACKUP_DIR` outside the repo (manual testing can leave real account data in it), and restore
it with the steps above:

```bash
set -a; source .env.local; set +a
BACKUP_DB_URL="$SUPABASE_DB_URL" SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL" \
  BACKUP_DIR=~/dressing-room-local-backups pnpm backup
```

## 8. Privacy policy and store forms

**Status: Pending.**

- **Pending.** Publish `docs/privacy-policy.md` and `docs/privacy-policy.es.md` on GitHub Pages
  (the contact address `hello.aabv21@gmail.com` is already in both).
- **Pending.** Store privacy forms: App Store Connect's privacy policy URL and App Privacy answers,
  and Play Console's Data safety form and policy URL.

## 9. End-to-end flows

**Status: Pending.** `pnpm e2e` on the iOS simulator and `E2E_PLATFORM=android pnpm e2e` on the
Android emulator, against the local stack ([`testing.md`](testing.md#end-to-end-flows-maestro)),
before a release build. All three flows pass on both.

## 10. Release builds and submission

**Status: Pending.** iOS waits on Apple (phase 3).

- **Pending.** Google Play: create the app in Play Console, then a Google service account key (a
  JSON file; `https://expo.fyi/creating-google-service-account`) uploaded to EAS (expo.dev
  credentials or `eas credentials`); the key never goes in the repo. The first `eas submit` creates
  the first internal-testing release (or upload that first AAB by hand).
- **Pending.** `pnpm dlx eas-cli@27 build --profile production --platform ios|android`, then
  `eas submit --profile production --platform ios|android` (fill in `eas.json`'s real `ascAppId`
  first, or pass it as a flag), then add testers to the TestFlight internal group and confirm the
  Play internal track's testers before sharing either build.

## Release configuration (`eas.json`)

The EAS CLI isn't a dependency: run it as `pnpm dlx eas-cli@27 <command>`.

- `cli.version: ">= 27.0.0"`: the CLI stops when it's older than the major this config targets.
- `base` pins the builders' Node (24.22.1) and pnpm (11.1.0): EAS's default image runs Node 22, and
  `engines.node` (`>=24`) makes `pnpm install` fail on it. Keep both in step with CI's Node major
  and `packageManager`. Both build profiles extend it.
- `preview`: `distribution: "internal"`; on Android `buildType: "apk"`, so it installs directly; on
  iOS an ad-hoc build (a regular Apple Developer membership).
- `production`: `distribution: "store"`, `autoIncrement: true`.
- Each profile names its EAS environment (`preview` or `production`), whose variables hold the four
  `EXPO_PUBLIC_*` values (phase 4); `.env.local` never reaches EAS.
- `cli.appVersionSource: "remote"`: EAS owns the build number; `app.json` keeps only the user-facing
  `version` and never gains `ios.buildNumber` or `android.versionCode`.
- `submit.production`: NOTE: `ios.ascAppId` is the placeholder `REPLACE_IN_INTEGRATION_SESSION`
  until the App Store Connect record exists; `android.track: "internal"` is the starting track,
  promoted only once internal testing passes.
