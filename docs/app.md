# The app: modules under `src/`

What each client module does and how the pieces fit. The endpoints they call are in
[`api.md`](api.md); the tests for each are in [`testing.md`](testing.md).

## Routes (`src/app/`)

Expo Router routes: every file is a screen, and `_layout.tsx` files define navigators. Non-route
code (components, hooks, utils) stays outside `src/app/`.

- `(auth)/`: Welcome, Sign in and Forgot password. `(onboarding)/`: the clothing, body and style
  steps.
- `(tabs)/`: the five tabs. `index.tsx` is Today, `closet.tsx` the Closet, `build.tsx` Build,
  `for-you.tsx` For you and `profile.tsx` the Profile.
- The root Stack in `_layout.tsx` registers, inside the signed-in guard and without the tab bar:
  `camera`, `review`, `garment/[id]`, `rate` (pushed from Today and Build as
  `/rate?ids=<comma-separated garment ids>[&occasion=<occasion>]`) and `city` (Today's city, a modal
  sheet).
- Leaving never drops work silently: the camera with unsent shots and the garment detail with
  unsaved edits ask first through `usePreventRemove` (Discard / Keep editing), and Android's back on
  Forgot password's code step returns to the email step. `review`, `rate` and the garment detail
  share the `BackChevron` beside their title.

## Shared UI (`src/ui/`)

Components not tied to one route: `Screen` (the scrolling screen with its anchored CTA and keyboard
handling; `ScreenTitle` shows the title upper-cased but gives screen readers the words as written), `AnchoredCta`, `ChipGroup`, `GlassTabBar`, `OptionCard`, `TextField`, `layout.ts`
(`useBottomChrome`, `useLargeText`), `BottomSheet` (React Native's `Modal` sliding up, or fading in with Reduce Motion on, with a title over a `scrim`, at most 90% of the screen tall; a tap outside or the back button closes it; For you's stores and the share sheet use it), `ActionNotice` and `UndoNotice` (an action's error, queued note or Undo button above the
anchored buttons), `a11y.ts` (iOS screen-reader announcements; Android hears the live regions) and
`theme.ts`: the color tokens (components hard-code no color, so a dark palette can follow), the
`fontSizes` type scale (11 pt at the smallest, 15 pt body) and the shadows. `useWaitStage` times an
AI wait, so Today, the rating and For you say "Still thinking…" at 6 s and "Almost there…" at 20 s. A chosen chip or segment
is filled with the `selected` violet, which Build's active slot row takes as its border. `feedback.ts` holds `tapHaptic` (a light impact
for commit actions, a selection tick for choices, silent on a device without haptics) and the
pressed styles. `charts/` holds the Stats charts: `KpiTile`, `HorizontalBars` (most worn; bars grow
with reanimated unless reduced motion is on, rows tappable) and `ProportionBar` (the colors, real
garment hexes, each segment and legend entry tappable).

## Translations (`src/i18n/`)

`en.ts` is the source of truth and `es.ts` the only other table (neutral Latin American Spanish).
The app speaks to the user in the second person, never as "I" or "we"; only button labels in the
user's own voice ("I'll wear it", "Export my data") say "I" or "my".
`I18nProvider` follows the device language, with an in-app override.

## The closet (`src/closet/`)

- **`ClosetProvider`** (`useCloset`): the garments, signed thumbnail URLs, an offline copy in kv
  `closet.v1.<userId>`, and `usePendingPolling`, a 5 s refresh while an extraction is pending. It
  also refreshes on foreground and reconnect.
- **`UploadQueueProvider`** (`useUploadQueue`): enqueue, counts, retry/discard, and
  `pause`/`clear`/`resume` for account deletion. It runs the queue on mount, enqueue, foreground,
  reconnect and at the next backoff, never while the user's account deletion is unconfirmed
  (`account.deleting.<userId>`); then, on mount, foreground and reconnect it only verifies the
  deletion with `confirmPendingDeletion`, never deleting without a tap. On mount it also clears
  every other account's queue that has a `queue.purge.<id>` request (`upload/queuePurge.ts`).
- Both providers wrap the signed-in navigator in `src/app/_layout.tsx`, keyed by user. Both drop
  late results once their user is gone, and the queue steps refuse to upload or commit an item under
  another account's session (a retryable `SessionMismatchError`).
- **`closetSelectors.ts`**: the pure derivations: active vs donated garments, stale pending, the
  review queue, the fields review asks about, slot and category counts, and the grid cells with the
  slot, category and color filters (a category chip row appears when the slot holds more than one
  category).
- **The Closet tab's segments** (`SegmentTabs.tsx`): Items (the grid, with `GoalCard`'s first-10
  goal), Stats (`StatsSegment.tsx`: period chips, KPI tiles, most worn, colors, balance, cost per wear and the
  unused-for-6-months list with Suggest tomorrow and Donate, computed by `src/stats/`) and Diary
  (`DiarySegment.tsx`: a Monday-first month calendar with each worn day's thumbnail; a tapped day's
  wears with their pieces, occasion and score, and Delete) and Saved (`SavedSegment.tsx`: the saved
  outfits newest first with the saved date and score; Rate opens `/rate?ids=…`, "I'll wear it" goes
  through `useWearLog` with its Undo, logging only the pieces still there and available, and
  disabled with "Some pieces aren't available" when those no longer make a complete outfit; Delete
  asks first; offline, the stored list with a note).
  `/closet?segment=saved` opens Saved (the rating's "See it in Saved") and then clears the param.
- **`GarmentFields.tsx`**: the per-field chip editors (`FieldEditor`, which can be disabled), the
  read-only `ConfirmedRow` and `changedFields` (the save patch: only the fields that differ), used by
  the review queue (`src/app/review.tsx`) and the garment detail (`src/app/garment/[id].tsx`).
- **`GarmentPhoto.tsx`**: the full photo over a checkerboard, signed on demand and again whenever
  `photo_version` changes. **`leaveToCloset.ts`**: the shared back action (back, or the closet when a
  deep link left no history). **`useNow`**: the clock for render-time derivations such as a pending
  garment turning stale after 10 minutes.
- **Capture:** `src/app/camera.tsx` is the burst camera, with `ShotStrip` showing the latest shots;
  `useGalleryImport` picks up to 30 photos and hands them to the queue (the camera and the Closet
  share it).
- **`price.ts`**: the optional price. `parsePrice` reads either decimal style ("12,50" and "12.50"
  are 12.5; one separator followed by exactly three digits groups thousands, so "250.000" is
  250000, but a first group starting with 0 is refused, so "0.500" and "00,500" never read as 500)
  up to `numeric(10,2)`'s ceiling; `priceOf` pairs the price with its currency (null for an
  unpriced row or one cached before the columns existed); `deviceCurrency` is expo-localization's
  `getLocales()[0].currencyCode` (USD when missing); `currencyChoices` is the picker's list
  (`COMMON_CURRENCIES`: USD, COP, MXN, EUR, VES, ARS, CLP, PEN, BRL, with the device's or the stored
  code first when it's another); `costPerWear` is `price / max(wear_count, 1)`; and `formatMoney`
  uses `Intl.NumberFormat` in the app locale and the garment's own currency, with the fraction
  digits set by `moneyFormatOptions` rather than the device's ICU data (which disagree on COP and
  CLP): 0 for COP, CLP and VES (VES keeps céntimos on paper, but prices aren't quoted in them), 2
  for USD, MXN, EUR, ARS, PEN and BRL, and the currency's own standard for any other code. Amounts in different
  currencies are never summed or compared. The garment detail's Price field and currency chips join
  its Save (an invalid price disables it with a hint; clearing the price clears the currency), and
  the detail shows "Cost per wear: $2.50 after 12 wears" for a priced garment.
- **`garmentRepository.ts`**: the garment data layer: list, signed photo URLs, photo uploads,
  insert, edits, review confirmation, and delete (photos before the row).

### The upload queue (`src/closet/upload/`)

- `queueStore.ts`: SQLite persistence, schema version 1 in `PRAGMA user_version`, with CHECKs on the
  stage and flags. New garments and photo replacements; a burst is stamped one millisecond apart so
  it uploads in order; a photo that can't be copied is reported while the rest still queue;
  `clearQueue` drops one user's rows and copies.
- `queuePurge.ts`: the kv requests `queue.purge.<id>` to clear a forgotten account's queue. Unlike
  the account's other per-user keys, a request outlives `forgetAccountOnDevice` until the provider
  has carried it out.
- `runQueue.ts`: the stages, backoff, concurrency 2 and 8 attempts. `pauseQueue` lets a stage in
  flight finish and starts nothing more for that user until `resumeQueue`; a stopped item keeps its
  attempts and is due at once.
- `cutout.ts`: the only caller of `modules/garment-cutout` ([its README](../modules/garment-cutout/README.md)).
- `preparePhoto.ts`: the cut-out, one decode capped at 784 px saved as WebP 0.8, and a 256 px WebP
  0.7 thumbnail built from that image.
- `queueSteps.ts`: the real prepare, upload and commit steps; `permanentUploadError.ts`: a rejected
  upload that retrying can't fix.

## Auth (`src/auth/`)

- `authService.ts`: a barrel over `emailAuth.ts` and `socialAuth.ts`. Both default their `client`
  parameter to `src/lib/supabase.ts`'s singleton; the `integration` Jest project maps that import to
  a stub (`integration/lib-supabase.stub.ts`).
- `AuthProvider` (`useAuth`): the session, the signed-in email, the profile read once per sign-in
  and shared by every screen (`profile`, `profileStatus`, `refreshProfile`, and
  `replaceProfileLocal` for a patch a screen just saved; a failed re-read keeps the last good one,
  and a failed launch read is retried on foreground and reconnect),
  the device language reconciled with `profile.language` once per sign-in, an offline launch kept signed in from the stored session,
  and, when a session ends or another user signs in, `forgetInterruptedDeletions` for any account
  whose deletion was under way (which also records its `queue.purge.<id>` request).
- `deviceState.ts`: per-account facts for offline launches: the last known onboarding status and a
  language choice still waiting to be saved; `forgetAccount` drops both.
- `useSignOut`: sign-out with a visible failure message; offline it falls back to a local sign-out;
  a successful one drops the display caches (`forgetDisplayCaches`), keeping the upload and wear
  queues and Logged ✓.
- `emailAuth.ts`'s `signOutLocally` is the sign-out after an account deletion: local scope, never
  failing, clearing the stored session directly when supabase-js can't finish;
  `storedSessionUserId` (no request) lets the deletion check it is still that user's session.
- `socialAuth.ts`: Sign in with Apple (with a nonce, then the fire-and-forget `apple-token` call)
  and Google (no nonce; see [`red-team.md`](red-team.md#parked)). The two Google client ids are
  read as literal `process.env.EXPO_PUBLIC_*` members and `GoogleSignin.configure` runs lazily on
  first use; without them Google sign-in answers `auth.error.unknown`.

## The profile (`src/profile/`)

`profileRepository.ts` (`getProfile`; `saveProfile`, an update of only the changed columns, never an
upsert; `completeOnboarding`, stamped by the server clock), `validation.ts` (the same ranges as the
database CHECKs), `bodyType.ts`, `useCurrentCity` (expo-location, when-in-use only),
`useClothingType` (the shared profile's clothing type for garment editors, `everything` until
known), `OnboardingProvider` (re-reads the profile itself before any onboarding step renders, so a
failed launch read can't overwrite a finished profile with defaults), and the shared form: `profileDraft.ts` (the
state, its mapping to columns and the changed-fields diff) plus `ProfileForm.tsx` (`ClothingSection`,
`BodySection`, `StyleSection`), used by onboarding and the Profile tab. The tab shows "Save changes"
only while there's a change (or a save, its error, or "Saved" for 2 seconds), with a failed save in
the button's notice slot until the next edit, holds the daily reminder's section
([below](#the-daily-reminder-srcreminder)), and lists household mode as "Coming soon", a row with no action.

## Supabase client and storage (`src/lib/`)

- `supabase.ts`: SQLite-backed session storage, the request timeouts from `fetchWithTimeout.ts`
  (12 s, 45 s for functions, 60 s for uploads) and `readStoredSession`. It throws on a missing URL or
  anon key.
- `database.types.ts`: generated by `pnpm db:types`.
- `requestResult.ts`: `runRequest` maps a write's outcome to `network` / `invalid` / `unknown`.
- `localDate.ts`: the device's calendar day, sent with each function call and used for the days
  Stats, Diary and Today show.
- `kv.ts`: the only `expo-sqlite/kv-store` caller; `kvGetJson` reads a stored JSON value through a
  type guard (null when absent, unreadable or of another shape). `kvKeys` lists every key for the deletion
  cleanup; once an account's data is dropped, `kvSet` refuses keys with its id as a segment until
  that account signs in again.
- `useOnResume.ts`: runs a callback on returning to the foreground and when the network comes back;
  the closet, the upload queue and the wear queue catch up through it.
- `e2eLaunch.ts`: `quietDevToastsForE2e` hides LogBox's toasts in a dev build Maestro launched with
  `-e2e 1`.

## Outfits (`src/outfits/`)

- `aiClient.ts`: `rateOutfit`, `fetchLuckyList` and `fetchForYou` with their `AiError` mapping
  ([`api.md`](api.md#how-the-app-maps-errors)).
- `outfitRepository.ts`: `logWear` (the idempotent `log_wear` RPC with a client wear id reused on
  retry) and `saveOutfit` (with the score the rating showed).
- `savedOutfits.ts`, `storedSaved.ts` and `useSavedOutfits.ts`: the Saved list: `listSavedOutfits`
  (at most 200, newest first) and `deleteSavedOutfit` (only a saved outfit no wear points at), the
  last good list in kv `outfits.saved.v1.<userId>`, and the hook that fetches it on focus and falls
  back to the stored copy.
- `outfitDisplay.ts`: the pieces' display order, `pieceLabel` ("Blusa · Negro") and Today's weather
  line.
- `buildSelection.ts`: Build's selection: one garment per slot, a one-piece and top/bottom exclude
  each other, one bag, hat or accessory, so a built outfit has at most five pieces against
  `rate-outfit`'s six; `canRate`, `selectionIds` and `retainSelection`. On the Build tab a pick in a
  required row moves on to the next empty one below it, and the disabled button names what's missing
  ("Pick shoes to rate").
- `useStoredQuery.ts`: a function answer fetched one request at a time for the latest inputs and
  shown over its stored copy until this session has one (`offline` when the fetch couldn't
  connect); Today's list and For you are built on it.
- `useLuckyList.ts` and `storedLucky.ts`: Today's list with debounced closet-driven refetches, the
  last good list per occasion for the day in kv `today.lucky.<userId>`, and `useTodayOccasion`.
  The list hides at once an outfit with a piece that's unavailable or out of suggestions
  (`isSuggestable`: only an explicit `suggest = false`, so a closet row cached by an older build
  without the field counts as on) or that was dismissed; `skip` and `dismiss` show the next one.
  A dismissal refetches only when fewer than 3 outfits are left; a piece turned off changes the
  closet fingerprint, so the list refetches 3 s later, and `lucky-list` answers from its cache
  minus those outfits.
- `storedDismissed.ts`: the dismissed combinations on the device, in kv `outfits.dismissed.<userId>`
  (the latest 500), read through `useDismissed`, so a stored or older list never shows one again,
  also after a restart. Profile's restore clears it.
- `suggestionFeedback.ts`: Today's "Not for me". `dismissOutfit` stores the outfit's sorted ids in
  `dismissed_outfits` (a repeat is a no-op) and `stopSuggesting` sets a garment's `suggest` to
  false. For 5 seconds after either, Today offers Undo (`undismissOutfit`, `resumeSuggesting`) in
  the CTA notice slot. The garment detail's "Use in suggestions" switch turns a piece back on
  through `updateGarment`, and Profile's "Restore hidden suggestions" (`countDismissed`,
  `restoreDismissed`, after a confirm with the count) deletes every dismissed combination.
  `outfitIdentity.ts` is the shared outfit key.
- `useForYou.ts` and `storedForYou.ts`: For you's ideas in the app's language, fetched on focus one
  request at a time, with the last good answer per language in kv `forYou.ideas.<userId>`.
- `storeLinks.ts` and `StoreSheet.tsx`: For you's "Search in stores" opens a sheet of the stores
  for the device's region (expo-localization's `regionCode`). `storeLinksFor(region, query,
  language)` is pure: CO Falabella, Mercado Libre and Google Shopping; MX and AR Mercado Libre and
  Google Shopping; CL Falabella, Mercado Libre and Google Shopping; PE Falabella and Mercado Libre;
  BR Mercado Livre; anywhere else (or no region) Google Shopping and Google, in the app language.
  Each URL is a fixed host with the idea's `searchQuery` URL-encoded (Mercado Libre's listing URLs
  join the words with hyphens), so nothing in the query changes where a link goes. There are no
  affiliate tags; `storeUrl` holds the one `NOTE:` where a tag would be appended. A store the
  browser refuses to open says so (`forYou.openFailed`).
- `wearQueue.ts`: "I'll wear it" offline. `logWearOrQueue` logs the wear or, on a network failure,
  queues it in kv `wear.queue.<userId>` and reports it logged; `flushWearQueue` sends the queue in
  order, one flush per user, only under that user's stored session, drops a wear the server refuses
  as `invalid` and stops at any other failure; `withQueuedWears` adds unsent wears to Stats and
  Diary. `WearQueueFlusher.tsx` flushes on mount, foreground and reconnect.
- `useWearLog.ts`: "I'll wear it" for Today and the rating screen: one wear at a time, one wear id
  per outfit until it succeeds, logged or queued, marked worn, announced, and the failed or queued
  note kept with the outfit it was for. A logged wear is announced with "Undo available", and for 5
  seconds after (15 with a screen reader on) `undo` takes it back: out of the queue if it's still
  there, else `deleteWear` (the trigger lowers the counts), then `unmarkWornToday` and a closet
  refresh. A failed undo, including one whose wear a flush is still sending (no row to delete yet),
  says "Couldn't undo" and offers Undo again for a new window.
- `wornToday.ts`: `useWornToday`, the outfits logged today in kv `outfit.worn.<userId>`, shared by
  Today and the rating screen; Diary's Delete and the undo call `unmarkWornToday`.
- `ShareCard.tsx`, `ShareOutfitSheet.tsx` and `shareOutfit.ts`: "Share" on the rating result (the
  header's share icon) and on Today's card opens a sheet with the card the outfit is shared as: the
  pieces' cut-out thumbnails stacked as a look on a light background, the score when known, and a
  small "Dressing Room" footer. The card scrolls inside the sheet, and the capture targets the card's
  own view, not the scroll viewport, so a tall look is captured whole. "Share image" is enabled once
  every thumbnail has loaded or failed (or after `IMAGE_WAIT_MS`, 3 s), so a capture never shares an
  empty card; the wait starts over each time the sheet opens. It calls `shareOutfitImage`, which checks
  `Sharing.isAvailableAsync()`, captures the card with `react-native-view-shot`'s `captureRef`
  (`format: 'png'`, `result: 'tmpfile'`) and opens `Sharing.shareAsync(uri, { mimeType: 'image/png',
  UTI: 'public.png' })`, then `releaseCapture(uri)` deletes the temporary PNG; it never throws, so a capture or share-sheet failure (or no sharing on the
  device) stays in the sheet as an announced message. The card's view has `collapsable={false}` so
  Android keeps it for the capture. `react-native-view-shot` is a native module (added with
  `pnpm expo install`; a new build is needed). Its `react-native` export is the raw `.tsx` source,
  which fails this repo's strict compiler flags, so `tsconfig.json`'s `paths` points the package at
  its compiled `lib/index`: TypeScript reads `lib/index.d.ts`, and Metro (which honors the same
  `paths`) bundles `lib/index.js`. Drop that entry once the package's source passes the flags.
- `OutfitStack.tsx`, `ScoreRing.tsx` (the number and arc count up to the score, or show it at once
  with Reduce Motion; the rating screen adds a success haptic as the result arrives), and `types.ts`
  (the functions' response types, re-exported from their `handler.ts`).

## The daily reminder (`src/reminder/`)

A local notification at a time the user picks, inviting them to open Today. No server, no push
token: the phone schedules it and shows it at its own wall clock, so it follows the local time zone
when the user travels.

- `reminderStore.ts`: the settings on this device, per account, in kv `reminder.<userId>`:
  `{ enabled, hour, minute, notificationId, language }`, off at 07:30 by default. The key's
  `<name>.<id>` shape lets account deletion clear and refuse it.
- `dailyReminder.ts`: `turnOnReminder` creates the Android `daily-reminder` channel (Android 13
  shows no permission prompt without one), asks for notification permission only when the system
  still can (iOS provisional counts as allowed), then schedules one notification with a `DAILY`
  trigger (`hour`, `minute`, the channel), "Your outfit for today is ready" / "Tu outfit de hoy
  está listo" in the app language, and `data: { kind: 'dailyReminder', url: '/' }`; it answers
  `on`, `denied` or `failed`. `scheduleReminder` (a new time or language) cancels the stored id
  before scheduling, and every change runs after the previous one, so two quick changes never
  leave two notifications. `turnOffReminder` cancels and keeps the time; `cancelStoredReminder`
  reads the id synchronously and cancels in the background, for the deletion.
  `presentRemindersInForeground` (the root layout's module scope) shows a reminder that arrives
  with the app open, silently.
- `ReminderSection.tsx`: Profile's "Daily reminder" card: the switch, the time (Intl's `7:30 AM` /
  `7:30 a. m.`) opening a sheet of hour and 5-minute chips with Done, and on a denial the reason with
  an "Open settings" link (`Linking.openSettings`). A time picked while off is only stored.
- `DailyReminderSync.tsx`, mounted in the signed-in, onboarded tree: a tap on the reminder (the
  launch tap from `getLastNotificationResponse`, or one while the app runs) navigates to Today and
  clears the response; a change of app language re-schedules an enabled reminder in it.
- Turning off on the way out: `AuthProvider` turns the reminder off for the account whose session
  ended (any `SIGNED_OUT`, so the next person on the phone never gets it), keeping the time;
  `forgetAccountOnDevice` cancels it before removing the account's kv keys.

## Voice (`src/voice/`)

"Listen" reads the screen aloud with `expo-speech`, the phone's own text-to-speech.

- `speechText.ts`: what is read, as short sentences (a label's " · " becomes a pause):
  `todaySpeech` (Today's pieces in display order, the weather line when there is weather, and
  "Occasion: …" when one is picked), `ratingSpeech` ("Score 82 out of 100: Looks good." and each
  reason the screen shows) and `ideaSpeech` (For you's idea name and its line).
- `speech.ts`: `pickVoice(voices, locale)` picks the installed voice for the app language: for
  Spanish es-MX, es-US, then es-419 (the neutral Latin American copy), then any Spanish voice; for
  English en-US, then any English voice; an enhanced voice wins within a tag, and Android's
  `es_MX` tags match too. `useSpeaker(text)` keeps one utterance app-wide (a module-level owner
  read through `useSyncExternalStore`): another button's Listen stops the current one, a second tap
  stops it, and leaving the screen (`useIsFocused`), unmounting or new text (Today's "Another")
  stops it too. It is `hidden` when the phone lists voices but none in the app language; an empty
  list (an engine still starting) keeps the button, and a speak error then alerts "This phone has no
  voice for this language."
- `ListenButton.tsx`: the round Listen / Stop button (Volume2 / Square), on Today's card header,
  the rating's header (once a result is shown) and each For you card.

## Stats and Diary (`src/stats/`)

All computed on the device. `periods.ts` (local `YYYY-MM-DD` day math anchored in UTC, the period
ranges and the Monday-first month grid), `statsModel.ts` (the KPIs, most worn, color shares, slot
balance, the unused list, `costPerWearByCurrency` and the diary by day), `wearsRepository.ts` (`listWears` in pages of 1000,
at most 20, and `deleteWear`; the trigger lowers the counts), `storedWears.ts` (the last fetched
wears in kv `wears.v1.<userId>` with the range they cover, read when a fetch fails) and
`useWears.ts` (a range's wears for Stats' year and Diary's month, fetched on focus with the queued
ones added, stored, and served from the stored copy offline).

Stats' "Cost per wear" card (`costPerWearByCurrency`) groups the active priced garments by
currency, the groups with the most priced pieces first, and shows each group's best value (the
lowest cost per wear among worn pieces) and its "forgotten and priced" piece (the most expensive one
never worn); a never-worn piece is never the best value, since its cost per wear is its whole
price. With several currencies each group is headed by its code; amounts are never summed or
compared across them. Each line opens the garment, and the card is hidden with no priced garment.

## Account privacy (`src/account/`)

- `accountClient.ts`: `deleteAccount`, `verifyAccount` (Auth's view of the session token; no
  function call) and `exportData`, plus `exportFileName` (`dressing-room-export-YYYY-MM-DD.json`).
- `deletionMarker.ts`: the kv marker `account.deleting.<id>` (`deleting:<ms>` or `reauth:<ms>`) and
  `forgetInterruptedDeletions`.
- `deletionFlow.ts`: `runDeletion` (only from the user's tap) and `confirmPendingDeletion` (the
  provider's check); one run per user at a time. `DELETION_SETTLE_MS` is 10 minutes.
- `forgetAccount.ts`: `forgetAccountOnDevice` cancels the daily reminder, then removes every kv key
  with the user's id as a dot-separated segment, plus `deviceState`'s entries, after refusing that
  user's later kv writes.
  New per-user kv keys must keep the `<name>.<id>[.<more>]` shape to be cleared and refused;
  `queue.purge.<id>` is the one key it keeps.
- `deviceFiles.ts`: `removeExports` and `forgetDeviceFiles` (the exports plus expo-image's caches).
- `usePrivacyActions.ts`: one flow at a time. Export checks the share sheet, replaces earlier exports
  and shares as `public.json`; delete asks twice, then runs `runDeletion`. Profile's Sign out stays
  disabled while either runs.

### Account deletion on the device

The server side is in [`database.md`](database.md#account-deletion-and-data-export-plan-5).

The app first writes the kv marker `account.deleting.<uid>`, then pauses its upload queue (a stage in
flight finishes), so no photo lands after the function's listing, and sends the session's access
token explicitly. It reports the account deleted only on `{ outcome: 'deleted' }`, or on a 401 for
which Auth's `GET /user` with that same token answers `user_not_found` (a retry after a lost 200).
Any other 401 (an expired token, `session_not_found`, a refresh token that's gone) or no session at
all doesn't prove the account is gone, so the app tells the user to sign in again and delete the
account again (`reauth`), and signs out locally, keeping the queue and the kv entries (the marker
turns `reauth`). Signing in doesn't finish anything by itself: the check below sees the account
still there and removes the marker, and the user taps "Delete account" again.

On a deletion the app clears the queue, signs out locally, clears every kv key under the user's id
(the marker included) and refuses that user's later kv writes for the rest of the process; then it
removes the data exports and clears expo-image's memory and disk caches. Either sign-out happens only
while the stored session is still that user's (or there is none). Any other failure (network, a 500,
a gateway 502/504) may come after the server already deleted the user, so the marker stays: the user
stays signed in, is told the deletion couldn't be confirmed and that photo uploads are paused, and
can tap again.

While the marker exists that user's queue never runs. Any value whose state is `deleting` or `reauth`
counts, whatever its time; a missing or malformed time, or one more than the settle window in the
future, is stamped anew at the next check. A launch, sign-in, return to the foreground or reconnect
with the marker present only asks Auth whether the account still exists: `user_not_found` gets the
same local cleanup and sign-out; the same user, more than 10 minutes after the marker (the function
may still be sweeping storage after the app's 45 s timeout), removes the marker and lets the queue
run; anything else keeps the marker.

A session that ends while the marker says `deleting` (supabase-js signs out by itself once the
account is gone) drops that account's kv data and records `queue.purge.<uid>`. The next upload queue
provider to mount, for whichever user signs in next, clears that account's queued rows and photo
copies and drops the request; a failed clear keeps it. If that same account signs in again first,
its session shows the account still exists, so the request is only dropped.

## Other folders

- `src/perf/`: the on-device frame-stats harness (UI-thread frame callback, stats, HUD), shown in
  fixture mode ([`performance-gate.md`](performance-gate.md)).
- `src/test/`: shared Jest helpers and mocks; never imported by app code.
