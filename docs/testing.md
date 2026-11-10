# Testing

Four Jest projects, one pgTAP suite and three Maestro end-to-end flows. `pnpm test` runs the
three Jest projects that need no Docker; `pnpm test:int` and `pnpm db:test` need a running local
Supabase stack (see `AGENTS.md`'s "Local backend"), and `pnpm e2e` also needs an iOS simulator.

## Jest projects (`jest.config.ts`)

### `app`

Component and hook tests under `src/**/*.test.[jt]sx?`, running under `jest-expo`'s React Native
environment. `jest.setup.ts` mocks:

- `react-native-safe-area-context` — the package's own Jest mock, so insets are deterministic.
- `expo-localization` — `getLocales()` returns a fixed `en-US` locale, so i18n-dependent tests don't
  depend on the host machine's language.
- `expo-sqlite/kv-store` — replaced with an in-memory `Map` behind the same synchronous
  `getItemSync`/`setItemSync`/`removeItemSync`/`getAllKeysSync` API `src/lib/kv.ts` calls, since
  there is no native SQLite module under Jest.
- `Dimensions` — the window and the screen report `fontScale` 1, since React Native's Jest preset
  reports 2, which would render every large-text layout. A suite that tests large text mocks it.

Uses `@testing-library/react-native` v14: `await render(...)` and `await fireEvent...` (both are
async in v14).

The closet suites (Plan 3) render each screen directly, with the closet, upload queue, repository
and profile seams mocked by `jest.mock`, and build garment rows with `src/test/garmentFixture.ts`:

- `src/closet/__tests__/` — `catalog.test.ts` (the enums match `database.types.ts`, slots and the
  per-clothing-type categories, every label translated), `closetSelectors.test.ts` (stale and live
  pending, a reviewed garment never live pending, the review queue, the fields review asks about,
  slot counts, grid cells), `ClosetGrid.test.tsx`, `GarmentFields.test.tsx` (each field's chips and
  what they store, a disabled editor, `changedFields`), `garmentRepository.test.ts` (the queries and
  storage calls against a fake client, error mapping, delete order), `ClosetProvider.test.tsx`
  (refresh, the kv offline copy, re-signing, a bumped `photo_version` re-signed at once, a poll that
  found nothing new committing nothing, polling, late results after sign-out or a user switch, a
  re-sign that lands after the account's deletion leaving no kv copy, foreground and reconnect),
  `GarmentPhoto.test.tsx` (the full photo signed once, and again for a new `photo_version`),
  `UploadQueueProvider.test.tsx` (when the queue runs, counts, retry/discard, the backoff timer,
  `pause` waiting for the queue and keeping its photos, `clear`, `resume` with and without a run,
  and an unconfirmed deletion marker blocking every run and only verified on mount, foreground and
  reconnect, never deleted and with no Alert; on mount, each other account's `queue.purge.<id>`
  request clears that queue and is dropped, the provider's own user's is dropped without a clear,
  and a request whose clear failed stays), `ClosetScreen.test.tsx` (the goal card, slot chips,
  the review banner, the processing and failed tiles, the gallery picker, opening a garment) and
  `GoalCard.test.tsx` (the progress wraps under the title at a large text size).
- `src/closet/upload/__tests__/` — `queueStore.test.ts` (SQLite rows through a fake database:
  enqueue, replacements, conditional saves, `clearQueue` dropping one user's rows and copies),
  `runQueue.test.ts` (stages, resuming an interrupted item, backoff, failing after 8 attempts or a
  permanent error, an attempt claimed before a stage runs so a native crash still counts toward the
  8, concurrency 2, and `pauseQueue`: a stage in flight finishes but no upload, commit or next item
  starts, a stopped item keeps its stage and attempts and is due at once, and nothing runs until
  `resumeQueue`), `preparePhoto.test.ts` (the resize arguments for portrait, landscape and small
  photos, one decode capped at 784 px with the thumbnail built from it, WebP qualities, the cut-out
  or the source photo), `cutout.test.ts` (the native module present, missing, or throwing) and
  `queueSteps.test.ts` (the real steps, the session check, replacements).
- `src/__tests__/camera.test.tsx` — the burst camera: permissions, the shutter and shot strip, Done,
  and the Discard / Keep shooting confirm on Close and on a back gesture.
- `src/__tests__/review.test.tsx` — the review queue: only the doubted fields are asked, Skip and
  Confirm, the card stays pinned while polling reorders the queue, a save error by the buttons, and
  the caught-up button goes back (or to the closet with no history).
- `src/__tests__/garment-detail.test.tsx` — the garment detail: a save sends only the changed field
  and is disabled until something changed, a network error keeps the edit, the status saves at once
  and reverts on error, delete confirms first and goes back (or to the closet with no history), a
  failed delete keeps the screen, Replace photo queues the picked photo, editors are disabled while
  the AI is still reading, and an unknown id shows "not found".

The Profile tab's Privacy section (data export and account deletion):

- `src/account/__tests__/accountClient.test.ts` — `deleteAccount` against a fake client: the
  function's 200 `{ outcome: 'deleted' }` is a deletion and any other 200 body isn't; a 500 or a
  network error is a failure with no Auth check; the session's token is sent explicitly, and no
  session is `reauth` without a call (a refresh that fails offline is `network`); a 401 is a
  deletion only when Auth answers `user_not_found` for that same token, and `reauth` on
  `session_not_found`, `refresh_token_not_found`, a missing session, an expired token, any other
  Auth error or a user who still exists; Auth unreachable is `network`. `verifyAccount` calls no
  function: `user_not_found` for the session token is `gone`, the same user is `exists`, and
  another user, Auth unreachable, an expired token, a lost session or no session is `unknown`.
  `exportData`'s document and failures, and `exportFileName`'s local-day name.
- `src/account/__tests__/deletionMarker.test.ts` — the `account.deleting.<id>` marker's states, and
  `forgetInterruptedDeletions` dropping a `deleting` account's data and marker while keeping a
  `reauth` one's and the active user's own, and recording a `queue.purge.<id>` request only for the
  dropped account.
- `src/account/__tests__/deletionFlow.test.ts` — `runDeletion`: the marker is written before the
  pause; deleted clears the queue, signs out, drops the data and marker and clears the device files,
  and a failing queue clear or kv cleanup still signs out; a per-user kv write after the cleanup is
  refused; `reauth` keeps the queue and data, marks `reauth` (not when supabase-js's own sign-out
  already dropped the data) and signs out; neither answer signs out another account that signed in
  meanwhile; `network` and `unknown` both keep the marker and the blocked queue; a second call while
  one runs is `busy`; the messages. `confirmPendingDeletion` never calls `deleteAccount`: `gone`
  gets the confirmed deletion's local cleanup and sign-out; `exists` within the 10-minute settle
  window of the marker stays pending, and past it removes the marker and runs the queue; a marker
  whose time can't be trusted (missing, malformed, or more than the settle window in the future) is
  stamped anew and stays pending, so the window starts over; `unknown` keeps both.
- `src/auth/__tests__/AuthProvider.test.tsx` (its interrupted-deletion part) — a session lost while
  a deletion is marked `deleting` drops that account's kv data and records a queue purge request; a
  `reauth` one keeps its data and records none; another
  user signing in drops a `deleting` account's kv data and keeps their own marker for their
  session's check; that account signing in again can write its kv data again.
- `src/account/__tests__/forgetAccount.test.ts` — every kv key under the user's id goes (each day's
  `today.occasion.<id>.<date>` too), with the onboarding status and pending language save; another
  account's keys, the device's language preference and a `queue.purge.<id>` request stay; the
  user's later writes are refused
  (also the id-less onboarding and language entries), and lifted once that account signs in again.
- `src/auth/__tests__/signOutLocally.test.ts` — against a real supabase-js client and a fake
  `fetch`: a deleted user's valid token (`user_not_found`), an expired token whose refresh is
  refused (`refresh_token_not_found`), and offline with an expired token (the stored session is
  cleared directly) all end in SIGNED_OUT with nothing left in storage; `storedSessionUserId`.
- `src/__tests__/profile-privacy.test.tsx` — through the real route tree: the section's note and
  buttons; Export replaces earlier exports in the cache directory and opens the share sheet as
  `public.json`, no share sheet on the device has its own message, and a failed export, file write
  or share shows the export message; a second Delete or an Export while the delete confirms are
  open does nothing, and two "Delete forever" presses delete once; Delete's two confirms (cancel at
  either does nothing), the upload queue paused before the function and cleared only after a
  deletion, then the local sign-out, the kv cleanup, the exports and image caches removed and the
  queue resumed; a failed deletion keeps the session, the queued photos and the data and can be
  retried; `reauth` shows "Sign in again, then delete your account again to finish." and signs out
  locally, keeping the queued photos and the data; Sign out is disabled while an export or a
  deletion runs, and a late `reauth` after another account signed in neither signs it out nor
  alerts it.
- `src/lib/__tests__/e2eLaunch.test.ts` — the Maestro launch check: `-e2e 1` in the user defaults
  is an end-to-end launch (anything else, or no native settings module, isn't), and only then are
  LogBox's toasts hidden.

Accounts, onboarding and the profile:

- `src/__tests__/auth-guards.test.tsx` — the root guard: no route and the splash screen while the
  session loads, signed out to Welcome (a deep link too), and signed in to onboarding or the tabs.
- `src/__tests__/root-layout-loading.test.tsx` — a later loading state keeps the auth screens
  mounted instead of unmounting the navigator.
- `src/__tests__/auth-screens.test.tsx` — Welcome, Sign in and Forgot password: field validation
  before any call, the social buttons (no Apple on Android, cancel shows nothing, disabled while one
  runs), service errors, and the reset code's two steps (format, invalid code, resend, change
  email).
- `src/auth/__tests__/authService.test.ts` — sign-up, sign-in, sign-out (offline falls back to a
  local sign-out), the password-reset request (no account and the email rate limit both answer
  ok) and its confirmation, against a fake client. `errors.test.ts` maps Auth and native errors to
  message keys, `nonce.test.ts` checks the Apple nonce and its SHA-256, and
  `signOutOffline.test.ts` signs out offline with an expired session and clears only the session's
  storage keys.
- `src/__tests__/onboarding.test.tsx` and `onboarding-arrival.test.tsx` — each step's saves, skips
  and errors, the body-type helper and height slider, a relaunch mid-onboarding, never overwriting
  a finished profile, and landing on the Closet after the last step.
- `src/__tests__/profile.test.tsx` — the Profile tab: prefilled sections, Save sending only the
  changed fields, inline validation, the language switch and its saves, another account signing in,
  and sign-out.
- `src/__tests__/city.test.tsx` — Today's city sheet: a typed city, the current location (or a
  denied permission), an unchanged city, a failed save or profile read.
- `src/profile/__tests__/` — `profileRepository.test.ts` (updates of only the patch, an update that
  reaches no row as an error, the server-stamped onboarding time, error mapping),
  `profileDraft.test.ts` (the form state, its patch and the changed fields), `validation.test.ts`
  (the measurement ranges), `bodyType.test.ts` (the body-type table), `useCurrentCity.test.tsx`
  (city-level precision only) and `ProfileForm.test.tsx` (the body-type grid and the height row at
  a large text size).

Outfits, Stats and Diary:

- `src/__tests__/today.test.tsx` — Today's lucky list: the occasion chips, debounced refetches on
  closet changes, one fetch at a time, "I'll wear it" with a reused wear id, the too-small, weather,
  quota and error states, and the stored list offline (its note wraps at a large text size).
- `src/__tests__/build.test.tsx` — Build's slot rows, category chips, one-pieces and the optional
  row, unavailable garments left out, and a slot row at a large text size.
- `src/__tests__/rate.test.tsx` — the rating screen: the score, label, confidence and reasons,
  the swap, Save, "I'll wear it", the quota and error states, and the ring named in Spanish too.
- `src/__tests__/for-you.test.tsx` — For you's cards, the stored ideas per language, the too-small,
  quota and offline states, and one request at a time.
- `src/__tests__/wornToday.test.tsx` and `src/outfits/__tests__/wornToday.test.ts` — "Logged ✓"
  shared by Today and the rating per user and day, also after a restart, and cleared for a deleted
  wear.
- `src/outfits/__tests__/` — `aiClient.test.ts` (the function wrappers' error mapping and
  `localDate`), `buildSelection.test.ts`, `outfitDisplay.test.ts` (slot order, piece labels, the
  weather line), `outfitRepository.test.ts` (`log_wear` and `save_outfit`), `storedLucky.test.ts`
  and `storedForYou.test.ts` (the offline copies), `OutfitStack.test.tsx` (a piece label wraps at
  a large text size) and `ScoreRing.test.tsx` (one progressbar named "Score", the number and
  caption capped for large text with the ring growing with them).
- `src/__tests__/closet-stats.test.tsx` — the segments, the KPIs per period ("1 outfit logged",
  "2 outfits logged"), most worn, a color opening the filtered closet, the balance, the unused list
  (Wear it and Donate, its row at the largest text sizes) and donated garments left out of Items and
  Build.
- `src/__tests__/closet-diary.test.tsx` — the month calendar (worn days, month navigation, day
  numbers that stay inside their cells at a large text size, where the thumbnail shrinks), a day's
  wears, deleting a wear (today's too), and the empty and Spanish months.
- `src/stats/__tests__/` — `periods.test.ts` (the period ranges and the Monday-first month grid),
  `statsModel.test.ts` (the KPIs, most worn, color shares and slot balance) and
  `wearsRepository.test.ts` (the wears query and Diary's delete).

Shared UI, the app shell and helpers:

- `src/ui/__tests__/` — `AnchoredCta.test.tsx` and `ChipGroup.test.tsx` (roles, states and the CTA
  label's cap), `GlassTabBar.test.tsx` and `SegmentTabs.test.tsx` (tablists, selection and the
  large content viewer), `OptionCard.test.tsx` (the emoji's cap), `layout.test.ts`
  (`useBottomChrome` and `useLargeText`) and `theme.test.ts` (error text contrast).
- `src/ui/charts/__tests__/charts.test.tsx` — `HorizontalBars` (rows as buttons, selection, the
  columns growing with the text and the stacked rows above the large-text threshold),
  `ProportionBar` (widths, each color read once, 44 pt targets) and `KpiTile` (a full row at a large
  text size). `reducedMotion.test.tsx` — with Reduce Motion on, the bars and the score ring render
  their final state without animating.
- `src/i18n/__tests__/` — `i18n.test.ts` (es has exactly the en keys, every reason and label the
  functions send has a message, neutral Spanish statuses) and `I18nProvider.test.tsx` (the device
  language, the override and its persistence).
- `src/lib/__tests__/` — `supabase.test.ts` (the client's options, a missing URL or key named in the
  error, auto-refresh with the app state), `fetchWithTimeout.test.ts` (12 s, 45 s for function
  POSTs, 60 s for uploads) and `storedSession.test.ts`.
- `src/perf/__tests__/` — `frameStats.test.ts` (dropped frames at 60 and 120 Hz, the inferred
  refresh rate) and `PerfHud.test.tsx` (tap to reset, long-press to clear the image caches).
- `src/__tests__/smoke.test.tsx` — the Today screen renders.

### `scripts`

Tests for `scripts/**/*.test.ts` (repo tooling, e.g. `scripts/env-local.ts`), running under plain
Node — no Expo globals, no React Native. Kept out of the `app` project because `jest-expo`'s preset
installs lazy globals (`fetch`, `structuredClone`, …) that conflict with a `scripts` test file's own
`@jest-environment node` docblock during teardown.

- `scripts/__tests__/env-local.test.ts` — `pnpm env:local`: the four Supabase keys in a fixed order,
  a half-configured env refused, and every other line of an existing `.env.local` kept.
- `scripts/__tests__/db-start.test.ts` — the local Apple test key: a one-line P-256 PKCS#8 PEM,
  written owner-only when missing and kept across restarts.
- `scripts/__tests__/check-supply-chain.test.ts` — the repo's `pnpm-workspace.yaml` passes; a
  missing or weakened `trustPolicy`, a missing `minimumReleaseAge` or any `trustPolicyExclude`
  fails.
- `scripts/__tests__/perf-fixtures.test.ts` — the 500 fixture specs and file names, a transparent
  SVG, and `perf:serve` refusing paths outside the fixtures folder.
- `scripts/__tests__/calibration.test.ts` — the Jev calibration: Spearman's ρ on a hand-computed set
  with a tie (and null, never NaN, when undefined), the predicted band and the confusion matrix, the
  weight search (on the 0.05 grid, summing to 1, deterministic, never lowering ρ, unchanged when
  nothing improves, `weather_fit` never moved, a ρ tie broken by accuracy), the band search's tie
  rule toward 70/50 and `great` kept above `good` (capped at 100, flagged in the report), the
  confidence aggregate (`min` chosen when its ρ is higher, the current one kept on a tie or when
  both are undefined), `evaluate` with unknown weather neutralized, and tiny, skewed or broken data
  (all-`good` labels, 3 outfits, a missing answer, a malformed labels or answers file), each a
  named error with no report and no NaN. `eval` on the
  fictional `calibration/example.*.json` fixtures, through `runEval` and the real CLI (exit codes 0,
  1 and 2). `export` and `collect` only through their helpers: rows built into the `rate-outfit`
  state, the service-role reads against a fake `fetch`, merging into an existing labels file, and
  which outfits still need an answer, against a fake Jev; the collect summary (a hint to check
  `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` when every call failed) and the owner-only (0600)
  mode of a rewritten local file. The CLI runs with the Supabase and TypeSafe keys blanked, so it
  can't reach either; nothing calls a real service.
- `scripts/__tests__/backup.test.ts` — the hosted backup. The helpers come first: the UTC folder
  name, rotation (the newest 14 kept, never a `.partial` or a foreign name), `stalePartials` (only
  `.partial` folders more than 7 days old by their embedded time, the exact boundary kept, an
  impossible time ignored), manifest entries, log redaction, and the env (`~/` expansion, missing
  variables named, a relative or in-repo `BACKUP_DIR` refused, and so are the home folder and the
  filesystem root; a password that isn't valid percent-encoding answered with an encoding hint that
  doesn't echo it). `runBackup` runs in a temp folder with a fake command runner for the two
  `pnpm exec supabase db dump` calls and a fake Storage `fetch`. A complete run checks the files,
  `manifest.json`, the rename, the rotation and the newest backup's age in the log. Every file is
  `0600` and every folder `0700`, and a looser existing root is tightened. It also covers an empty
  bucket, more than a full list page, and a server that caps pages below the limit (the list pages
  until an empty page). A run deletes `.partial` folders over 7 days old before it starts, also when
  it then fails. After the first failed download, no new download starts. `verifyBackup` passes a
  complete backup, names a changed or missing file, refuses a manifest path that leaves the folder,
  and reports a missing or malformed manifest. Halfway failures cover a failed schema or data dump,
  a refused list, a 500 or 404 on one object, `fetch` throwing, an unsafe object name, a missing
  `pnpm`, and an existing `.partial`. Each exits non-zero, leaves only its `.partial` and rotates
  nothing, and no log line holds the database URL, its password or the service-role key. No spawned
  command line holds the password either, decoded or percent-encoded; the dump gets it in
  `PGPASSWORD`, and a `BACKUP_DB_URL` that isn't a Postgres URL is refused with the percent-encoding
  hint, without being echoed. The real dump, restore and photo upload are checked by hand against
  the local stack (`docs/database.md`'s "Hosted backups").
- `scripts/__tests__/e2e.test.ts` — `pnpm e2e`'s pure parts: the fresh `e2e-<epoch ms>@example.com`
  address, `JAVA_HOME` (an existing one kept, Homebrew's `openjdk@17` used when it's unset or empty,
  a message naming `brew install openjdk@17` when there's neither), the `maestro` and
  `simctl addmedia` arguments, an `addmedia` timeout reported apart from a non-zero exit, the
  booted simulators read from `simctl list -j` and the one picked (the only booted one, or
  `E2E_SIMULATOR` by UDID or name; several booted with none named is an error), the stack check
  (`supabase status -o json` failed, unreadable or without an API URL, and `.env.local` pointing the app elsewhere), and
  `integration/mockServices.ts`'s weak-piece Jev mode (its `--serve` options refuse `--level`
  together with `--weak`).

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
  uncertain. The `claude-adversarial-*.json` fixtures pin it against a manipulated model: out-of-enum
  values, extra fields aimed at server-only columns or prototype keys, instruction-like strings,
  JSON wrapped in prose, and output cut off at `max_tokens`.
- `supabase/functions/_shared/__tests__/rating.test.ts` — the Jev request (8 Score, 2 Noul and 1
  Choice questions, the weakest-piece options shuffled, no measurement in the state), answer
  parsing (a missing or out-of-range answer is null, a rounding error is clamped), unknown weather
  neutralized, and the composite score with the hard-failure cap at 40.
- `supabase/functions/_shared/__tests__/fallbackRater.test.ts` — the Claude fallback rater's
  request (a JSON schema of level indices, two booleans and the weakest slot; no measurement) and
  its parser.
- `supabase/functions/_shared/__tests__/outfitRules.test.ts` — seasons by hemisphere, complete
  outfits, missing slots, the occasions' formality ranges, the weather rules, the pre-score, this
  week's wears, pinned garments and candidate generation.
- `supabase/functions/_shared/__tests__/forYou.test.ts` — the archetypes per clothing type (valid
  enums, no repeats), owning one, the combinatorial gain (formality, season, color and pattern
  rules, one-pieces, outerwear, the cap on a large closet), the ranking, the Jev fit, the Claude
  lines and their template fallbacks, and the store-search query.
- `supabase/functions/_shared/__tests__/weather.test.ts` — the Open-Meteo URLs, weather bands and
  conditions, and the forecast and geocoding parsers.
- `supabase/functions/_shared/__tests__/userContext.test.ts` — the JWT's `sub`, `mapLimit`, the
  profile and garments read with the user's token (enums checked, non-uuid ids refused before any
  request), and the cached weather.
- `supabase/functions/_shared/__tests__/apple.test.ts` — `appleEnvFrom`, the ES256 client secret
  (a PEM with literal `\n`s too), the id_token's Apple user, and the token exchange and revoke
  calls.
- `supabase/functions/_shared/__tests__/photoStore.test.ts` — the Storage boundary against a fake
  `fetch`: photo paths (non-uuid ids refused), the URL, method and service-role headers of every
  call, listing past 1000 entries and at most 5 folders at a time, removal in chunks of 1000,
  signing one path or 500 per call, a missing object as `null` (a 404, or Storage's 400 with
  `"statusCode": "404"`), a throw on a 5xx, and that no function file outside `photoStore.ts`
  contains `/storage/v1/`.
- `supabase/functions/_shared/__tests__/gateway.test.ts` — the gateway's JWT check, read from
  `supabase/config.toml`: every function folder has its own `[functions.<name>]` section and no
  section names a missing folder; every user-called function has `verify_jwt = true`, since
  `userIdFromJwt` reads the token's `sub` without checking its signature; and `extract-attributes`,
  the database webhook, is the only one with `verify_jwt = false`, checking its `x-webhook-secret`
  header instead and never reading a JWT.
- `supabase/functions/extract-attributes/__tests__/handler.test.ts` — the webhook secret and method
  checks, the happy path, an exhausted quota (`over_quota`, no Claude call), a Claude call aborted
  after 30 s (`failed`), a garment no longer pending, already reviewed or missing, a guarded
  write-back that matches no row because the user reviewed or edited it meanwhile (`skipped`; the
  `updated_at` filter carries the exact value read before the Claude call), a row without a
  readable `updated_at` (500, no Claude call), adversarial
  Claude responses (`claude-adversarial-*.json`) writing only the attribute columns, and logs that
  carry only the garment id and an outcome word.
- `supabase/functions/rate-outfit/__tests__/handler.test.ts` — the Jev score and its cache (keyed by
  the garments, occasion and profile, not by a logged wear), the quota (fails closed), Jev and
  Claude both failing (503), unknown weather, a foreign garment id (404 before any quota), the swap
  search, and no measurement reaching Jev or Claude.
- `supabase/functions/lucky-list/__tests__/handler.test.ts` — too-small closets, the 30 ranked
  outfits spread over the closet (at most 5 Jev calls at once, this week's wears left out), the
  deterministic candidate order, the cache per occasion and date, and a garment edit recomputing it.
- `supabase/functions/for-you/__tests__/handler.test.ts` — too small, the 3–5 ideas in gain × fit
  order with Claude lines and store queries (Spanish too), what Jev and Claude see, each model
  failing (template lines or gain-only order, cached degraded), and laundry or donated garments.
- `supabase/functions/apple-token/__tests__/handler.test.ts` — the code exchange stored with the
  service role and never returned, an identity mismatch, no Apple env (`skipped`), 401 and 405.
- `supabase/functions/export-data/__tests__/handler.test.ts` — every section, rows read with the
  caller's token and only the caller's paths signed for 7 days, another user's rows dropped, paging
  until an empty page (also when the server caps a page below 1000 rows), a brand-new account, a
  failed read or signing answering 500, and a log of only an outcome word.
- `supabase/functions/delete-account/__tests__/handler.test.ts` — the order (photos, Apple revoke,
  user), paging and chunks, the caller check (only `user_not_found` means already deleted), a
  retry after the user is gone sweeping only the caller's folder (photos that landed while the
  answer was lost), a 404 from the user deletion sweeping again, the final best-effort sweep after
  the deletion (a photo uploaded meanwhile is removed; a failed sweep still answers `deleted`),
  failures answering 500 so the app retries, and logs with outcome words only.

### `integration`

`integration/*.int.test.ts`, also plain Node, exercising real behavior against a running local
Supabase stack:

- `auth.int.test.ts` — email/password sign-up and sign-in, the server's 8-character password
  minimum, and the password-reset code flow (via Mailpit; see below).
- `account.int.test.ts` — the account functions end to end through the gateway: `apple-token`
  exchanges a code with the mock Apple and stores the refresh token (and stores nothing for a code
  whose Apple user isn't the caller's); `export-data` returns the
  caller's rows and signed photo URLs; `delete-account` removes the caller's photos, revokes the
  Apple token with the mock and deletes the auth user, whose rows cascade, and a retry with the
  same token answers `deleted` without calling Apple again. A second user is untouched throughout.
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
  inserting the same id again makes no second Claude call; an edit saved through A's client while
  the mock Claude holds its answer for 4 s keeps the user's category (the garment stays `pending`);
  and a user whose daily quota is already
  used up (100 `consume_quota` calls through the service-role client) gets `over_quota` with no
  Claude call. Needs the Edge Runtime, so the full `pnpm db:start` or `pnpm db:start:ci`.
- `outfits.int.test.ts` — the outfit functions end to end through the real gateway, with the mock
  Jev, Open-Meteo and Claude below. User A has six reviewed garments (two tops, two bottoms, two
  pairs of shoes; inserted with A's session, then given attributes and `extraction_status: 'done'`
  with the service role) and stored city coordinates; B has none. `lucky-list` answers `kind: 'ok'`
  with complete outfits (one top, one bottom, one pair of shoes each) rated by the mock Jev, and a
  second call is served from `lucky_cache` with no Jev call; the forecast lands in `weather_cache`
  for the hour (fetched once, no geocoding for stored coordinates). `rate-outfit` answers Jev's
  score; a call without a session gets 401 (the anon key passes the gateway, and the function finds
  no user in it); B rating A's garment ids gets 404 `garment_not_found` (RLS hides them) with no Jev
  call; and with A's `usage_counters` row for the day pre-filled to 50, a new outfit gets 429
  `over_quota` with no Jev call. `for-you` answers 3–5 ideas whose lines are the mock Claude's
  (`mockAnthropic.ts`, answering a line for every archetype id), after at most 10 mock Jev fits and
  one Claude call; A's `for_you` usage counter is 1 and `for_you_cache` holds one entry (a seeded
  older entry is pruned), a second call returns the same body with no Jev or Claude call, and a
  Spanish call with the day's miss spent gets that newest entry back (`stale`), not a 429.
  `log_wear` called from supabase-js bumps `wear_count` on exactly the worn garments, as A's own
  `garments` select shows. Needs the Edge Runtime.

Not part of `pnpm test` or CI's `quality`/`security`/`actions` jobs — only the `database` job runs
it, after starting Supabase. Run it manually with
`pnpm db:start && pnpm db:reset && pnpm env:local && pnpm test:int` when touching auth, RLS,
profile or garment persistence, the extraction function, the outfit functions or the account
functions; `--runInBand` because the suites share one database and create/delete real
`auth.users` rows.

`integration/mockAnthropic.ts` is the mock Claude: `startMockAnthropic(port = 54499)` serves
`POST /v1/messages` on `0.0.0.0` (the function calls it from inside a container, as
`http://host.docker.internal:54499`, the local `ANTHROPIC_BASE_URL` in `supabase/config.toml`).
`respondWith({ status, body })` (with an optional `delayMs` before the answer) or
`respondWith({ hang: true })` sets the reply for every following call; `calls()` counts the calls; `close()` also drops hung connections. Replies reuse the recorded
fixtures in `supabase/functions/_shared/__tests__/fixtures/`, so the real API is never called.
`integration/mockServices.ts` stands in for TypeSafe's System One API (Jev) and Open-Meteo:
`startMockServices(port = 54498)` serves `POST /v1/systemone`, `GET /v1/forecast` and
`GET /v1/search` (geocoding) on `0.0.0.0`, where the local `TYPESAFE_BASE_URL`, `OPEN_METEO_URL`
and `OPEN_METEO_GEOCODING_URL` point (`http://host.docker.internal:54498`). `jev(next)`,
`forecast(next)` and `geocode(next)` set each route's reply (`MockReply`, the same shape as the
mock Claude's); `jev` also takes a function of the request body, and `jevAnswers(request, level)`
builds a well-formed answer to every question in it (each Score at `level` of its range, so the
composite score is `round(100 · level)`; each Noul at 0.02; each Choice `none`, using the
`criteria` keys). `calls(path)` counts the calls on a path; `close()` drops hung connections.
Until set, Jev answers every Score at its best level, the forecast is `MILD_FORECAST` (a dry 19 °C
day, band `mild`) and geocoding finds Madrid. For a manual simulator check,
`node integration/mockServices.ts --serve [--level <0..1> | --weak <category>] [--temp <°C>]` keeps
it running with every Jev answer at `level` (default 1) or, with `--weak`, the weak-piece answers
`pnpm e2e` uses (the two can't be combined), and, with `--temp`, a clear, dry day around that
temperature.

`integration/fixtures/garment.webp` is a 784 px, ~9 KB WebP of a garment silhouette, encoded once
with sharp from `scripts/perf-fixtures.ts`'s `fixtureSvg` and committed.

Function logs (one line per call: an outcome word, plus the garment id for `extract-attributes`;
the words are listed in `docs/ai.md`) are in
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
- `ai_caches.test.sql` — `rating_cache`, `lucky_cache` and `weather_cache` are server-only (no
  client select or insert, anon included), and the `rating` and `lucky` quota kinds count
  separately.
- `outfits_wears.test.sql` — `log_wear()` and `save_outfit()`: one outfit, its items and a wear,
  `wear_count` and `last_worn_at` kept on insert and delete, idempotent on the wear id (never
  adopting another user's), another user's garments or outfit refused, too few or duplicate items
  refused, cross-user isolation on `outfits`, `outfit_items` and `wears`, no client update, a wear
  deleted only by its owner, and a garment delete cascading its outfit items.
- `insights_account.test.sql` — the `donated` status and the client-writable `pinned_on`, the
  `for_you` quota kind, the server-only `for_you_cache` and `apple_tokens`, and that every public
  table with a `user_id` cascades from `auth.users` (deleting a user empties them all).
- `garment_extraction_trigger.test.sql` — the garments insert trigger's shape and privileges, the
  pg_net request it queues, and that an insert still succeeds with the Vault secrets missing or when
  queueing the request fails.
- `cache_cleanup.test.sql` — `prune_expired_caches()` deletes cache rows past each lifetime and
  keeps fresh ones and each user's newest For you row; the daily `pg_cron` job exists once; no
  client role can call the function.
- `schema_hygiene.test.sql` — rules checked across the whole `public` schema: no trigger function
  is executable by a client role, and no index is made redundant by another that starts with the
  same columns.

See `docs/database.md` for how these tests impersonate a user and create test rows without a real
JWT.

## End-to-end flows (Maestro)

`pnpm e2e` (`scripts/e2e.ts`) runs the three Maestro flows in `.maestro/flows/` on an iOS
simulator, or with `E2E_PLATFORM=android pnpm e2e` on an Android emulator, against the local stack
and the mocks, as a fresh user:

1. `onboarding-closet-lucky.yaml` — sign up, onboarding, four garments from the gallery, review,
   "I'll wear it" on Today's "feeling lucky" outfit, and the wear in Stats ("1 outfit logged").
2. `build-rate-swap.yaml` — Build an outfit around the T-shirt, rate it, "Try the swap".
3. `delete-account.yaml` — delete the account (both confirms), land on Welcome, and fail to sign
   in with it.

They share one account, created by the first and deleted by the last, so `.maestro/config.yaml`
runs them in that order and stops at the first failure. Each run signs up as
`e2e-<epoch ms>@example.com`, so a run that failed halfway (and left its user behind) never
collides with the next. Flows wait on visible text with `extendedWaitUntil`, never a fixed sleep.
The text is English, so the device's language must be English: `launchApp`'s `clearState` drops
the in-app language choice, and the app follows the device.

### Prerequisites

- **Maestro and Java 17.** `brew install maestro openjdk@17`. Both are machine tools, not repo
  dependencies. `openjdk@17` is keg-only, so it isn't on `PATH`. `pnpm e2e` uses `JAVA_HOME` when
  it's set; when it isn't, it uses `/opt/homebrew/opt/openjdk@17` (its `bin` first on `PATH`), and
  it fails with a message when neither exists. That fallback is Apple silicon's Homebrew prefix;
  on an Intel Mac, set `JAVA_HOME` yourself, to `$(brew --prefix openjdk@17)` or
  `$(/usr/libexec/java_home -v 17)`. To run `maestro` by hand, set it in that shell:

  ```bash
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17   # Intel: "$(brew --prefix openjdk@17)"
  export PATH="$JAVA_HOME/bin:$PATH"
  ```

- **A booted iOS simulator with the dev build** (`pnpm ios` once; rebuild after native changes)
  **and Metro running** on `:8081`. With several simulators booted, name one:
  `E2E_SIMULATOR=<udid or name> pnpm e2e`.
- **For Android, a running emulator with the dev build** (`pnpm android` once, with
  `JAVA_HOME` at Java 17: the Gradle build fails on Android Studio's bundled Java 25). `adb` comes
  from `ANDROID_HOME`, else Android Studio's default `~/Library/Android/sdk`. The emulator needs a
  Google Play system image (ML Kit's segmentation model comes from Play services); this repo uses
  an `android-36` `google_apis_playstore` arm64 image on a Pixel 9 AVD. Start it with
  `-gpu host`: its default software renderer makes the flows several times slower.
- **An English simulator.** Settings → General → Language & Region; the flows match English
  text.
- **The local stack:** `pnpm db:start`, then `pnpm env:local` (the app must point at it; the script
  checks).
- **Ports 54498 and 54499 free.** The script starts the mocks itself and stops them at the end.

### What the script does

1. Checks Java, Maestro, the simulator or emulator and the installed app, Metro, and the local
   stack, failing with what to run instead of timing out in a flow. On Android it also maps the
   emulator's ports 8081 (Metro) and the Supabase API's port to the Mac's with `adb reverse`,
   since the app's `127.0.0.1` is the emulator itself.
2. Starts `node integration/mockServices.ts --serve --weak t_shirt` and
   `node integration/mockAnthropic.ts --serve ok`, and waits for each to print that it's listening.
3. Copies the fictional photos in `.maestro/fixtures/` to a temporary folder and adds them to the
   simulator's library with `xcrun simctl addmedia <udid>`. The copy is needed because the
   simulator's media bridge can't open files under `~/Documents`, and `addmedia` then hangs
   instead of failing, so the script stops it after a time limit and says whether it timed out or
   exited with an error. The photos go in on every run, so the simulator's photo library grows by
   four each time (erasing the simulator empties it, and removes the dev build too); the flow picks
   the four newest. On Android they're pushed to `/sdcard/Pictures/` with `adb push`, under the
   same names each run, and a media scan makes the system photo picker list them.
4. Runs `maestro --device <udid> test --config .maestro/config.yaml .maestro/flows` with `EMAIL`
   and `PASSWORD` passed to the flows, then stops the mocks and exits with Maestro's status.

### How the flows drive the app

- **Extraction.** The mock Claude reads every photo as navy jeans (`claude-ok.json`), so review
  keeps the first as jeans and turns the others into a T-shirt, a shirt and sneakers through each
  card's Category row (`.maestro/subflows/recategorize.yaml`). Which photo gets which category
  depends on upload order, so a thumbnail may not match its label; the mock never looks at it.
  There's no cut-out on the simulator (no Vision), so each garment keeps its original photo.
- **The swap.** `--weak t_shirt` makes the mock Jev score any outfit holding the T-shirt at 40 and
  name the top as its weakest piece; every other outfit scores at the best level. A rating of the
  T-shirt outfit then offers the shirt, and the swapped outfit "Looks great".
- **Sign-up.** Email confirmation is off locally (`[auth.email].enable_confirmations = false`), so
  "Create account" signs in at once and no Mailpit step is needed. The password field is switched
  to plain text before typing, since typing into a secure field can drop characters.
- **Dev warnings.** Every `launchApp` passes `-e2e 1`. iOS puts it in the app's user defaults, and
  in a dev build `src/lib/e2eLaunch.ts` then hides LogBox's warning toasts. They sit over the
  anchored CTAs, so a tap there would open the debugger instead of pressing the button. Android
  has no such channel, so there the flows rely on the app logging no warnings: a new warning shows
  a toast over the tab bar, and fixing the warning is the cure (`adb logcat | grep ReactNativeJS`).
- **The photo picker.** The gallery step is a subflow per platform
  (`.maestro/subflows/pick-photos-ios.yaml` and `pick-photos-android.yaml`, chosen with `when:
  platform`). Android's system photo picker labels each photo "Photo taken on <date>"; the subflow
  taps the first four and "Done". iOS's picker isn't the app's UI, so its subflow taps the cells by
  Apple's own accessibility id, `PXGGridLayout-Info` at indexes 0 to 3, after
  waiting for its "Select up to 30 photos." prompt. Both are iOS internals, not a public API: an iOS
  update can rename them, and the flow then fails at the gallery step. Check them with
  `maestro hierarchy` on the open picker.
- **Fixtures.** `node scripts/e2e.ts fixtures` regenerates the four JPEGs with `sharp`, drawn from
  `scripts/perf-fixtures.ts`'s garment shapes on a plain background. They're fictional, never
  real photos.

### Why CI doesn't run it

There's no reliable simulator or emulator job yet: a macOS runner with a simulator, a dev build
and the local stack in Docker is slow and flaky, and the Linux runner has no iOS simulator. So
`pnpm e2e` runs locally before a release and after changes to the flows it covers, on both
platforms.

## Which tests need Docker

| Command        | Needs Docker (local Supabase) | Needs `.env.local` |
| --------------- | ------------------------------ | -------------------- |
| `pnpm test`     | no                              | no                    |
| `pnpm db:test`  | yes                             | no (connects directly) |
| `pnpm test:int` | yes                             | yes (`pnpm env:local` first) |
| `pnpm e2e`      | yes, plus a simulator or emulator and Metro | yes (`pnpm env:local` first) |

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
pnpm db:reset
pnpm db:test
pnpm env:local
pnpm test:int
pnpm e2e        # also needs the booted simulator with the dev build and Metro
pnpm db:stop
```

`pnpm db:start` (like `db:start:ci`) goes through `scripts/db-start.ts`, which first writes a
local-only Apple test key to gitignored `supabase/.temp/apple-test-key.pem` if it's missing;
`account.int.test.ts` needs it, so start the stack with the script, not a bare `supabase start`.

CI's `database` job (`.github/workflows/ci.yml`) runs the Docker-dependent steps in the same order,
on the same ports, since the config in `supabase/config.toml` applies in CI too (the stack runs
alone there, so there's no other local project to avoid colliding with). Two differences:

- It starts the lean stack, `pnpm db:start:ci` (no Studio, Realtime, analytics or image proxy).
  Mailpit stays up, since `test:int` reads reset codes from it, and so does the Edge Runtime, since
  `extraction.int.test.ts` runs the extraction function end to end.
- After `db:test` it regenerates the types and fails if they differ from the committed file
  (`pnpm db:types && git diff --exit-code src/lib/database.types.ts`), so a migration can't land
  without its `database.types.ts`.
