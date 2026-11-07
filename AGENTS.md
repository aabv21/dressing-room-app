# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

Dressing Room is a digital-closet and AI outfit rater app (Expo + Supabase), built as a portfolio demo. What works now: the Expo Router app shell (five tabs, glass tab bar, en/es), strict TypeScript, lint, tests, a closet-grid scroll-performance harness, and a Supabase-backed accounts system — email/password and social (Google, Apple) sign-in, a three-step onboarding flow, row-level-security-protected profiles, and an editable Profile tab sharing its form with onboarding.

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
- `pnpm test` — `jest --selectProjects app scripts` (unit tests only; no Docker needed).
- `pnpm test:int` — `jest --selectProjects integration --runInBand`: `src/auth`'s email/password and session flows, the cross-user RLS boundary, and `profileRepository`'s server-clock completion and language round-trip, against a running local Supabase (`pnpm db:start && pnpm db:reset && pnpm env:local` first). Not part of `pnpm test`; CI runs it in its own `database` job (`.github/workflows/ci.yml`). Run it manually when touching auth, RLS or profile persistence. See `docs/testing.md` for how the Jest projects and pgTAP fit together.
- `pnpm perf:generate [count=500]` — write the performance fixture thumbnails (WebP) to `.perf-fixtures/` (gitignored).
- `pnpm perf:serve [port=8787]` — serve `.perf-fixtures/` over HTTP and print every LAN URL, labeled by network interface.
- Fixture mode: start the app with `EXPO_PUBLIC_PERF_FIXTURES_URL=<url printed by perf:serve>` (e.g. `EXPO_PUBLIC_PERF_FIXTURES_URL=http://127.0.0.1:8787 pnpm expo run:ios`). The Closet tab then shows 500 fixture thumbnails, a disabled upload CTA, and the frame-stats HUD (tap: reset; long-press: also clear expo-image's memory and disk caches). Unset or empty, the Closet shows its empty state. The value is inlined at bundle time, so restart Metro after changing it.
- `pnpm check:expo` / `pnpm expo install --fix` — run during Expo SDK upgrades, after the 3-day `minimumReleaseAge` allows the new versions; informational, not a CI gate (see Supply-chain hardening).
- `pnpm db:start` / `pnpm db:stop` — start/stop the local Supabase stack (Docker, via OrbStack).
- `pnpm db:start:ci` — the lean stack CI starts: everything `db:test`, `db:types` and `test:int` need (Postgres, Auth, REST, Storage, Kong, postgres-meta, Mailpit), without Studio, Realtime, Edge Runtime, analytics or the image proxy.
- `pnpm db:reset` — reset the local database to the committed migrations and seed.
- `pnpm db:test` — run pgTAP database tests (`supabase test db`).
- `pnpm db:types` — regenerate `src/lib/database.types.ts` from the local schema.
- `pnpm env:local` — write `.env.local` from the running local stack's `supabase status -o env`.

Run `pnpm typecheck && pnpm lint && pnpm test` before declaring any task done.

## Folder map

- `src/app/` — Expo Router routes; every file here is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- `src/ui/` — shared UI components not tied to a single route.
- `src/i18n/` — translation tables; `en` is the source of truth, `es` is the only non-English file in the repo (see Conventions).
- `src/closet/` — closet domain logic (items, outfits, wear counts).
- `src/auth/` — the auth service (`authService.ts`, a barrel over `emailAuth.ts` and `socialAuth.ts`), session state (`AuthProvider`/`useAuth`, which also exposes the signed-in email, reconciles the device language preference with `profile.language` once per sign-in, and keeps a user signed in on an offline launch from the stored session), `deviceState.ts` (per-account facts kept on the device for offline launches: the last known onboarding status and a language choice still waiting to be saved) and `useSignOut` (sign-out with a visible failure message; offline it falls back to a local-only sign-out). `emailAuth.ts`/`socialAuth.ts` default their `client` parameter to `src/lib/supabase.ts`'s real `supabase` singleton, the same pattern `src/profile/profileRepository.ts` uses; `integration/`'s Jest project maps that import to a stub instead (see `jest.config.ts` and `integration/lib-supabase.stub.ts`).
- `src/profile/` — `profileRepository.ts` (`getProfile`, the upsert `saveProfile`, `completeOnboarding`, stamped by the server clock), Body validation (`validation.ts`, same ranges as the DB CHECKs), the body-type helper (`bodyType.ts`), `useCurrentCity` (expo-location, when-in-use only), `OnboardingProvider` (re-reads the profile before any onboarding step renders so a failed launch-time read can never overwrite a finished profile with defaults), and the shared editable form: `profileDraft.ts` (the form state, its mapping to columns, and the changed-fields diff) plus `ProfileForm.tsx` (`ClothingSection`, `BodySection`, `StyleSection`), used by both the onboarding steps and the Profile tab.
- `src/lib/` — the Supabase client (`supabase.ts`: SQLite-backed session storage, a 12 s request timeout from `fetchWithTimeout.ts`, and `readStoredSession`), generated `database.types.ts`, and `kv.ts` (the only `expo-sqlite/kv-store` caller).
- `src/perf/` — the on-device frame-stats harness (UI-thread frame callback, stats, HUD).
- `src/test/` — shared Jest helpers (e.g. the FlashList mock); never imported by app code.
- `.perf-fixtures/` — generated fixture thumbnails (gitignored; see `pnpm perf:generate`).
- `scripts/` — repo tooling (TypeScript, run with Node's native type stripping — no `.js`/`.mjs` sources).
- `integration/` — `*.int.test.ts` Jest suites that run against a live local Supabase (plain Node, no Expo/React Native — see `pnpm test:int` above and `helpers.ts`'s module doc for why `src/auth/emailAuth.ts` is imported directly rather than through `authService.ts`'s barrel). `lib-supabase.stub.ts` is mapped over `src/lib/supabase.ts` by `jest.config.ts`'s `integration` project, so the default-client path in `emailAuth.ts`/`socialAuth.ts` throws loudly instead of touching native modules if a test ever omits its client.

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
- `blockExoticSubdeps: true` — only a direct dependency may resolve from a git or tarball URL; every transitive dependency must come from the registry.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false` — a dependency's install/postinstall script fails the install unless it's explicitly approved in `allowBuilds`.
- `engineStrict: true` — a dependency whose `engines` range excludes this repo's Node fails the install instead of warning.
- `allowBuilds` lists only packages a real `pnpm install` proved need their build script, each with a one-line reason: `@parcel/watcher` (`jest-haste-map`'s file watcher; links a platform binary) and `unrs-resolver` (`jest-resolve`'s native resolver; same).

**`eslint-config-expo` is deliberately not used.** It pulls in `eslint-import-resolver-typescript`, whose only SDK-58-compatible version at the time had a trust-evidence regression this repo's `trustPolicy` correctly caught, with no newer or older in-range version to fall back on and no scoped exception the owner had reviewed. This repo instead composes `typescript-eslint`'s `strictTypeChecked`, `eslint-plugin-security`'s `recommended`, and `eslint-plugin-react-hooks`' flat `recommended-latest` directly in `eslint.config.ts` — no Expo-specific lint rules are lost that matter for a TypeScript-strict, React-Native-only (no web target) app at this stage.

**`pnpm check:expo` (`expo install --check`) is informational, not a CI gate.** It compares every installed package against the single latest version on the npm registry, with no awareness of `minimumReleaseAge` — so it will always flag a package whose newer release exists but is still too young to install under this repo's hardening. Run it (or `pnpm expo install --fix`) during a deliberate Expo SDK upgrade, after the candidate versions have cleared the 3-day age gate, not as part of the regular `typecheck`/`lint`/`test` gate.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`) to update `pnpm-lock.yaml`, run the gate below, and commit both files together. `minimumReleaseAge` will refuse a version published too recently — wait it out or pin an older compatible version instead.

## Local backend

The local backend is Supabase running in Docker (via OrbStack), driven only through the `supabase` npm devDependency (`pnpm exec supabase …` / the `db:*` scripts) — never a global or Homebrew install.

- `pnpm db:start` — starts the local stack (Postgres, Auth, Storage, Studio, Mailpit). First run pulls Docker images and can take several minutes.
- `pnpm db:reset` — drops and recreates the local database from `supabase/migrations/` and `supabase/seed.sql`.
- `pnpm db:test` — runs the pgTAP suite under `supabase/tests/`.
- `pnpm db:types` — regenerates `src/lib/database.types.ts` from the local schema; commit the result alongside the migration that changed it.
- `pnpm db:stop` — stops the stack. Always leave it stopped when you're done.
- `pnpm env:local` — writes `.env.local` (gitignored) from `supabase status -o env`: the app gets `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`; `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are for scripts and integration tests only. It merges rather than clobbers: it only ever writes those four keys (in that fixed order), and keeps every other line already in `.env.local` as-is — so a hand-set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (see "Social sign-in" below) survives a re-run.
- Local email (signup confirmations, password-reset codes) is caught by Mailpit at http://127.0.0.1:54424 instead of being sent.
- Password reset uses a 6-digit code (`{{ .Token }}` in `supabase/templates/recovery.html`), not a link.
- **The service-role key never goes in `src/`.** It bypasses Row Level Security; it belongs only in scripts, CI secrets, and test setup, read from `supabase status -o env` or `.env.local`, never bundled into the app.

## Social sign-in

- NOTE: `app.json`'s `@react-native-google-signin/google-signin` plugin config has a placeholder `iosUrlScheme` (`com.googleusercontent.apps.REPLACE_IN_INTEGRATION_SESSION`). The live owner session that sets up the real Google OAuth client replaces it with the project's actual reversed iOS client ID from Google Cloud Console — Sign in with Google on iOS will not work until then.
- Two more `EXPO_PUBLIC_*` vars are allowed in the app bundle: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. OAuth client IDs are not secrets — they identify the app to Google the way a bundle id does — so this doesn't widen the "no secrets in `EXPO_PUBLIC_*`" rule above. `src/auth/socialAuth.ts`'s `signInWithGoogle` reads both (literal `process.env.EXPO_PUBLIC_*` member expressions, same inlining constraint as the Supabase URL/key) and calls `GoogleSignin.configure({ webClientId, iosClientId })` lazily on first use; if either is missing it resolves `{ ok: false, error: 'auth.error.unknown' }` and logs a dev-only `console.warn` rather than attempting to sign in. The integration session fills both into `.env.local`/`.env.example` with the project's real Google OAuth client IDs.
- `@react-native-google-signin/google-signin` v17's free `signIn()` does not send a custom nonce — see `src/auth/socialAuth.ts`'s module doc (summary: no nonce on Android, a hidden one on iOS that this library doesn't expose; sending one anyway made every sign-in fail against GoTrue's OIDC check). `signInWithIdToken` is therefore called with no `nonce` for Google (Apple's flow is unaffected and still uses one). NOTE: the integration session must set `[auth.external.google].skip_nonce_check = true` in `supabase/config.toml` (and the hosted project's equivalent setting) for Google sign-in to succeed — see the NOTE above that config key. Google sign-in has no nonce replay protection from this client today. Upgrade path: a library version that exposes iOS's nonce, or Universal Sign In (this package's paid tier).

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test` all pass locally.
- No secrets anywhere in the diff.
- Commits follow Conventional Commits, on a descriptively named branch.
