# Dressing Room

**Demo**

A digital closet and AI outfit rater, built with Expo and Supabase.

**Status:** foundation — app shell and scroll-performance gate

## What works now

- Expo Router app (SDK 58) with strict TypeScript, lint, and tests.
- Five tabs (Today, Closet, Build, For you, Profile) behind a custom floating glass tab bar: liquid glass on iOS 26+, a blurred frosted capsule on older iOS, and a frosted fill on Android.
- English and Spanish UI, picked from the device language (anything else falls back to English).
- A Closet tab with a virtualized three-column grid (FlashList + expo-image). With no garments yet it shows an empty state.
- Fixture mode for performance testing: with `EXPO_PUBLIC_PERF_FIXTURES_URL` set, the Closet grid shows 500 generated thumbnails served from your computer, a disabled upload CTA, and a frame-stats HUD (frames, dropped frames, p95 and median frame time, inferred refresh rate). Tap the HUD to reset it; long-press it to also clear the image caches for a cold pass.

## Quick start

```bash
pnpm install
pnpm expo run:ios
pnpm test
```

Closet grid with performance fixtures (iOS simulator):

```bash
pnpm perf:generate   # once: writes 500 thumbnails to .perf-fixtures/
pnpm perf:serve      # serves them on port 8787 and prints the LAN URLs
EXPO_PUBLIC_PERF_FIXTURES_URL=http://127.0.0.1:8787 pnpm expo run:ios
```

On a physical iPhone, use the LAN URL `perf:serve` prints for the Wi-Fi the phone is on, and allow Local Network access when iOS asks.

See [`AGENTS.md`](./AGENTS.md) for the full command list and conventions.
