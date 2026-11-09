# Dressing Room

**Demo**

A digital closet and AI outfit rater, built with Expo and Supabase.

## What works now

- Expo Router app (SDK 58) with strict TypeScript, lint, and tests.
- Five tabs (Today, Closet, Build, For you, Profile) behind a custom floating glass tab bar: liquid glass on iOS 26+, a blurred frosted capsule on older iOS, and a frosted fill on Android.
- English and Spanish UI, picked from the device language (anything else falls back to English), with an in-app override.
- Accounts: email/password sign-up and sign-in, Sign in with Google and Sign in with Apple (iOS), and a 6-digit password-reset code sent by email.
- A three-step onboarding flow (clothing type, body measurements, style and occasions) with a skip action on all but the first step, backed by a Postgres profile row protected by row-level security.
- An editable Profile tab (clothing, body, style sections) sharing its form with onboarding, plus the language override, sign-out and a Privacy section: body data is visible only to you and the AI only gets ranges; "Export my data" shares a JSON file of your profile, garments, outfits, wears and 7-day photo links; "Delete account" (two confirms) removes your photos, revokes Sign in with Apple (once the owner sets the Apple key) and deletes your account and every row, then clears this phone's copy of your data (its saved data, data exports and cached photos) and signs you out. If the answer is lost, uploads stay paused and the app checks at the next launch whether the account is gone; it never deletes without your tap.
- A Closet tab with a virtualized three-column grid (FlashList + expo-image), a "Your 10 favorites" goal card and slot filter chips.
- Stats (Closet tab): week, month or 6 months of how much of your closet you wear, outfits logged, the average outfit score and your streak; what you wear most, your colors (tap one to filter the closet), the closet balance with how many more outfits one piece would open, and what you haven't worn in 6 months, with "Wear it" (in tomorrow's suggestions) and "Donate".
- Diary (Closet tab): a month calendar with each worn day's outfit; tap a day for its pieces, occasion and score, or delete a wear.
- Adding clothes: a burst camera (one garment per shot, no forms) and a gallery multi-select. Each photo goes through a queue kept on the phone: on-device background removal (iOS Vision, Android ML Kit), a resized WebP and thumbnail, then an upload to private storage. The queue resumes after the app is closed or offline, without losing or duplicating a photo.
- AI attributes: inserting a garment triggers an Edge Function that asks Claude for its category, colors, pattern, material, formality, seasons, warmth, fit and occasions (100 reads per user per day). Locally a mock Claude answers; nothing calls the real API until the owner sets the hosted keys.
- A review queue ("1 of 3") that asks only what the AI doubted, as quick choices, and shows the rest confirmed.
- Garment detail: edit any attribute, set it as available, in the laundry or lent out, replace its photo, or delete it (its photos are removed from storage too).
- Today: the day's weather for your city, an optional occasion, and a "feeling lucky" outfit from your closet (ranked by the Jev rating model, skipping what you wore this week) with "Another" and "I'll wear it", which logs the wear and bumps each piece's wear count. A closet missing a top, bottom or shoes is told what to add instead.
- Build: pick an outfit piece by piece (top and bottom or a one-piece, shoes, and optional outerwear and an accessory) from the garments that are available, filtered by category, then ask "How does it look?".
- Rating: a 0–100 score with a label, the AI's confidence, short reasons, and for a weak outfit a one-tap swap of its weakest piece; save the outfit or log it as worn. Jev rates it, with Claude as a fallback marked "estimated". Locally mock Jev and Open-Meteo services answer; nothing calls the real APIs until the owner sets the hosted keys.
- For you: 3–5 staples your closet is missing, ranked by how many new outfits each opens with what you own and how well it suits your body and style, each with a short line and a "Search in stores" button that opens a web search in your language. The last ideas stay readable offline. A low rating with no swap links here ("Missing something?").
- Fixture mode for performance testing: with `EXPO_PUBLIC_PERF_FIXTURES_URL` set, the Closet grid shows 500 generated thumbnails served from your computer, a disabled upload CTA, and a frame-stats HUD (frames, dropped frames, p95 and median frame time, inferred refresh rate). Tap the HUD to reset it; long-press it to also clear the image caches for a cold pass.
- Performance gate: [`docs/performance-gate.md`](./docs/performance-gate.md) — protocol for the on-device scroll-performance go/no-go call. Status: pending.
- AI red team: [`docs/red-team.md`](./docs/red-team.md) — prompt injection through photos and profile fields, the enum-bounded outputs and their sanitizers, quota abuse and cross-user access: each attack's defense and the test that pins it.

## Quick start

```bash
pnpm install
pnpm expo run:ios
pnpm test
```

### Local backend (accounts, profile, closet)

The app's accounts, profile and closet features need a running local Supabase stack:

```bash
pnpm db:start   # starts Postgres, Auth, Storage, Studio, Mailpit and the Edge Runtime in Docker (first run pulls images)
pnpm env:local  # writes .env.local with the app's Supabase URL/anon key
pnpm expo run:ios
```

Local signup confirmations and password-reset codes are caught by Mailpit at
`http://127.0.0.1:54424` instead of being emailed. `pnpm db:stop` stops the stack when you're done.
See [`AGENTS.md`](./AGENTS.md)'s "Local backend" section and [`docs/database.md`](./docs/database.md)
for the schema, and [`docs/testing.md`](./docs/testing.md) for how the backend is tested.

End-to-end flows (Maestro, iOS simulator): with the stack and Metro running and the dev build on a
booted simulator, `pnpm e2e` signs up a fresh user and walks through onboarding, the gallery,
review, Today, Stats, Build, the rating's swap and account deletion. It needs Maestro and Java 17
(`brew install maestro openjdk@17`); see [`docs/testing.md`](./docs/testing.md)'s "End-to-end flows".

Closet grid with performance fixtures (iOS simulator):

```bash
pnpm perf:generate   # once: writes 500 thumbnails to .perf-fixtures/
pnpm perf:serve      # serves them on port 8787 and prints the LAN URLs
EXPO_PUBLIC_PERF_FIXTURES_URL=http://127.0.0.1:8787 pnpm expo run:ios
```

On a physical iPhone, use the LAN URL `perf:serve` prints for the Wi-Fi the phone is on, and allow Local Network access when iOS asks.

See [`AGENTS.md`](./AGENTS.md) for the full command list and conventions.

### Owner setup

Three things need the owner before the hosted app works end to end:

- Rebuild the dev client (`pnpm expo run:ios` / `pnpm expo run:android`): `garment-cutout` is a local native module and `expo-sharing` (data export) has native code, so an older dev client fails to load the Profile tab.
- Set the hosted secrets, the `APPLE_*` ones included (without them, account deletion can't revoke Sign in with Apple).
- Run `eas init`, then `eas build` and `eas submit` against [`eas.json`](./eas.json)'s profiles, to put a build on TestFlight and the Play internal track.

The full checklist is [`AGENTS.md`](./AGENTS.md)'s "Owner session".
