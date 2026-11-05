# Dressing Room

**Demo**

A digital closet and AI outfit rater, built with Expo and Supabase.

## What works now

- Expo Router app (SDK 58) with strict TypeScript, lint, and tests.
- Five tabs (Today, Closet, Build, For you, Profile) behind a custom floating glass tab bar: liquid glass on iOS 26+, a blurred frosted capsule on older iOS, and a frosted fill on Android.
- English and Spanish UI, picked from the device language (anything else falls back to English), with an in-app override.
- Accounts: email/password sign-up and sign-in, Sign in with Google and Sign in with Apple (iOS), and a 6-digit password-reset code sent by email.
- A three-step onboarding flow (clothing type, body measurements, style and occasions) with a skip action on all but the first step, backed by a Postgres profile row protected by row-level security.
- An editable Profile tab (clothing, body, style sections) sharing its form with onboarding, plus the language override and sign-out.
- A Closet tab with a virtualized three-column grid (FlashList + expo-image). With no garments yet it shows an empty state.
- Fixture mode for performance testing: with `EXPO_PUBLIC_PERF_FIXTURES_URL` set, the Closet grid shows 500 generated thumbnails served from your computer, a disabled upload CTA, and a frame-stats HUD (frames, dropped frames, p95 and median frame time, inferred refresh rate). Tap the HUD to reset it; long-press it to also clear the image caches for a cold pass.
- Performance gate: [`docs/performance-gate.md`](./docs/performance-gate.md) — protocol for the on-device scroll-performance go/no-go call. Status: pending.

## Quick start

```bash
pnpm install
pnpm expo run:ios
pnpm test
```

### Local backend (accounts, onboarding, profile)

The app's accounts and profile features need a running local Supabase stack:

```bash
pnpm db:start   # starts Postgres, Auth, Storage, Studio and Mailpit in Docker (first run pulls images)
pnpm env:local  # writes .env.local with the app's Supabase URL/anon key
pnpm expo run:ios
```

Local signup confirmations and password-reset codes are caught by Mailpit at
`http://127.0.0.1:54424` instead of being emailed. `pnpm db:stop` stops the stack when you're done.
See [`AGENTS.md`](./AGENTS.md)'s "Local backend" section and [`docs/database.md`](./docs/database.md)
for the schema, and [`docs/testing.md`](./docs/testing.md) for how the backend is tested.

Closet grid with performance fixtures (iOS simulator):

```bash
pnpm perf:generate   # once: writes 500 thumbnails to .perf-fixtures/
pnpm perf:serve      # serves them on port 8787 and prints the LAN URLs
EXPO_PUBLIC_PERF_FIXTURES_URL=http://127.0.0.1:8787 pnpm expo run:ios
```

On a physical iPhone, use the LAN URL `perf:serve` prints for the Wi-Fi the phone is on, and allow Local Network access when iOS asks.

See [`AGENTS.md`](./AGENTS.md) for the full command list and conventions.
