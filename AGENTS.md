# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

Dressing Room is a digital-closet and AI outfit rater app (Expo + Supabase), built as a portfolio demo. The current foundation: the Expo Router app shell (five tabs, glass tab bar, en/es), strict TypeScript, lint, tests, and a closet-grid scroll-performance harness that later work builds on.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch `https://docs.expo.dev/llms.txt` — an index of all Expo docs with corrections to common LLM misconceptions (append `.md` to a doc page's path to fetch it as Markdown). Follow its links to the specific page you need; never answer from memory.

Docs for agents: `https://docs.expo.dev/llms.txt`

## Commands

- `pnpm install` — install dependencies.
- `pnpm expo install <package>` — add an Expo/React Native package, resolved to the SDK-compatible version. Use this instead of `pnpm add` for anything with native code; use `pnpm add` only for pure-JS tooling (lint, test, etc.) that `expo install` doesn't track.
- `pnpm start` — start the dev server.
- `pnpm ios` / `pnpm android` — start the dev server targeting a platform.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — `eslint .`.
- `pnpm test` — `jest`.
- `pnpm perf:generate [count=500]` — write the performance fixture thumbnails (WebP) to `.perf-fixtures/` (gitignored).
- `pnpm perf:serve [port=8787]` — serve `.perf-fixtures/` over HTTP and print every LAN URL, labeled by network interface.
- Fixture mode: start the app with `EXPO_PUBLIC_PERF_FIXTURES_URL=<url printed by perf:serve>` (e.g. `EXPO_PUBLIC_PERF_FIXTURES_URL=http://127.0.0.1:8787 pnpm expo run:ios`). The Closet tab then shows 500 fixture thumbnails, a disabled upload CTA, and the frame-stats HUD (tap: reset; long-press: also clear expo-image's memory and disk caches). Unset or empty, the Closet shows its empty state. The value is inlined at bundle time, so restart Metro after changing it.
- `pnpm check:expo` / `pnpm expo install --fix` — run during Expo SDK upgrades, after the 3-day `minimumReleaseAge` allows the new versions; informational, not a CI gate (see Supply-chain hardening).

Run `pnpm typecheck && pnpm lint && pnpm test` before declaring any task done.

## Folder map

- `src/app/` — Expo Router routes; every file here is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- `src/ui/` — shared UI components not tied to a single route.
- `src/i18n/` — translation tables; `en` is the source of truth, `es` is the only non-English file in the repo (see Conventions).
- `src/closet/` — closet domain logic (items, outfits, wear counts).
- `src/perf/` — the on-device frame-stats harness (UI-thread frame callback, stats, HUD).
- `src/test/` — shared Jest helpers (e.g. the FlashList mock); never imported by app code.
- `.perf-fixtures/` — generated fixture thumbnails (gitignored; see `pnpm perf:generate`).
- `scripts/` — repo tooling (TypeScript, run with Node's native type stripping — no `.js`/`.mjs` sources).

## Conventions

- Everything in English, except `src/i18n/es.ts`.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- `pnpm` (pinned to an exact 11.x in `packageManager`); Node `>=24`. Never `npm`/`yarn`/`bun`.
- TypeScript strict mode plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — no build step, no `.js`/`.mjs` source files.
- Lint: typescript-eslint `strictTypeChecked` + `eslint-plugin-security` recommended + `eslint-plugin-react-hooks` recommended (see Supply-chain hardening for why not `eslint-config-expo`).
- App identity (provisional until the owner picks a name): display name "Dressing Room", slug `dressing-room-app`, scheme `dressingroom`, bundle id / package `com.aabv21.dressingroom`.
- Light-only appearance (`userInterfaceStyle: "light"`) — v1 has no dark palette.
- Wear counts are always spelled out ("never worn" / "1 wear" / "N wears"; es: "sin usar" / "1 uso" / "N usos"), never "N×".
- CTAs are anchored pill buttons, 48pt tall minimum, 44pt hit targets everywhere.
- No secrets in the app yet. Never put keys in `EXPO_PUBLIC_*`: they are inlined into the bundle.

## Navigation & routing

- Use **Expo Router** for all navigation. Routes live in `src/app/`; `_layout.tsx` files define navigators.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: `https://docs.expo.dev/router/introduction.md`

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation) and gitignored. Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- After adding a library with native code, rebuild the dev client: `pnpm expo run:ios` / `pnpm expo run:android`.
- Prefer recommended Expo modules over third-party libraries, and check available skills before adding a dependency.

## Supply-chain hardening

Package management is pnpm, pinned in `package.json`'s `packageManager` to an exact `11.x` version. `pnpm-workspace.yaml` holds the settings pnpm 11 reads instead of `.npmrc`:

- `minimumReleaseAge: 4320` — refuses to install any package version (including transitive) published less than 3 days ago, so a newly-compromised release has a window to be caught and pulled before this repo can pull it in.
- `minimumReleaseAgeExclude: []` — no package is exempt from the age gate above.
- `trustPolicy: no-downgrade` — fails an install if a package's trust evidence (provenance/trusted publishing) regresses from an earlier release.
- `trustPolicyExclude` — a narrow, owner-approved, time-boxed exception list for a specific `name@version` whose trust regression was individually reviewed and judged benign (a maintainer republishing without provenance, not a takeover). Currently holds `semver@6.3.1`, pulled in transitively by `@babel/core` (via `expo-constants` → `@expo/require-utils` → `@babel/core`): the 2023 release predates npm trusted publishing, which `semver@6.3.2` (2026-11-02) adopted, making the older version look like a downgrade by comparison. Remove the entry once `6.3.2` itself clears `minimumReleaseAge` (2026-11-05) and the dependency graph can move to it.
- `blockExoticSubdeps: true` — only a direct dependency may resolve from a git or tarball URL; every transitive dependency must come from the registry.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false` — a dependency's install/postinstall script fails the install unless it's explicitly approved in `allowBuilds`.
- `engineStrict: true` — a dependency whose `engines` range excludes this repo's Node fails the install instead of warning.
- `allowBuilds` lists only packages a real `pnpm install` proved need their build script, each with a one-line reason: `@parcel/watcher` (`jest-haste-map`'s file watcher; links a platform binary) and `unrs-resolver` (`jest-resolve`'s native resolver; same).

**`eslint-config-expo` is deliberately not used.** It pulls in `eslint-import-resolver-typescript`, whose only SDK-58-compatible version at the time had a trust-evidence regression this repo's `trustPolicy` correctly caught, with no newer or older in-range version to fall back on and no scoped exception the owner had reviewed. This repo instead composes `typescript-eslint`'s `strictTypeChecked`, `eslint-plugin-security`'s `recommended`, and `eslint-plugin-react-hooks`' flat `recommended-latest` directly in `eslint.config.ts` — no Expo-specific lint rules are lost that matter for a TypeScript-strict, React-Native-only (no web target) app at this stage.

**`pnpm check:expo` (`expo install --check`) is informational, not a CI gate.** It compares every installed package against the single latest version on the npm registry, with no awareness of `minimumReleaseAge` — so it will always flag a package whose newer release exists but is still too young to install under this repo's hardening. Run it (or `pnpm expo install --fix`) during a deliberate Expo SDK upgrade, after the candidate versions have cleared the 3-day age gate, not as part of the regular `typecheck`/`lint`/`test` gate.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`) to update `pnpm-lock.yaml`, run the gate below, and commit both files together. `minimumReleaseAge` will refuse a version published too recently — wait it out or pin an older compatible version instead.

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test` all pass locally.
- No secrets anywhere in the diff.
- Commits follow Conventional Commits, on a descriptively named branch.
