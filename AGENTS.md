# AGENTS.md

Guidance for anyone, human or AI, working in this repository.

## Project

Dressing Room is a digital closet and AI outfit rater for iPhone and Android, built as a portfolio demo with Expo (SDK 58) and Supabase.
The app talks only to one Supabase project (Auth, Postgres with RLS, a private photo bucket, seven Edge Functions); only the functions call Claude, Jev (TypeSafe), Open-Meteo and Apple. Auth sends email through Brevo.
What it does and what works now: [`README.md`](README.md). How it works: [`docs/architecture.md`](docs/architecture.md).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch `https://docs.expo.dev/llms.txt` — an index of all Expo docs with corrections to common LLM misconceptions (append `.md` to a doc page's path to fetch it as Markdown).
   Follow its links to the specific page you need; never answer from memory.

Docs for agents: `https://docs.expo.dev/llms.txt`

## Commands

- `pnpm install`: install dependencies. `pnpm expo install <package>`: add a package with native code (SDK-compatible version); `pnpm add` only for pure-JS tooling.
- `pnpm start`: the dev server. `pnpm ios` / `pnpm android`: build the app with `expo run:*` and open it (Android toolchain: [`CONTRIBUTING.md`](CONTRIBUTING.md#android-toolchain)).
- `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (`eslint .`), `pnpm test` (the `app`, `scripts` and `functions` Jest projects, no Docker): the gate. See [`docs/testing.md`](docs/testing.md).
- `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects functions`: only the Edge Function tests (a path argument to `pnpm test` doesn't narrow it).
- `pnpm db:start` / `pnpm db:start:ci` / `pnpm db:stop` / `pnpm db:reset` / `pnpm env:local`: the local Supabase stack in Docker ([`docs/local-stack.md`](docs/local-stack.md)).
- `pnpm db:test`: pgTAP. `pnpm db:types`: regenerate `src/lib/database.types.ts` from the local schema.
- `pnpm test:int`: integration tests against the running local stack ([`docs/testing.md`](docs/testing.md#integration)).
- `pnpm e2e`: the Maestro flows on a simulator or emulator ([`docs/testing.md`](docs/testing.md#end-to-end-flows-maestro)). Not in CI.
- `node integration/mockAnthropic.ts --serve <fixture>` and `node integration/mockServices.ts --serve […]`: keep the mocks running for a manual check ([`docs/local-stack.md`](docs/local-stack.md#mocks)).
- `pnpm perf:generate`, `pnpm perf:serve` and `EXPO_PUBLIC_PERF_FIXTURES_URL=<url>`: the closet-grid fixture mode ([`docs/performance-gate.md`](docs/performance-gate.md)).
- `pnpm check:supply-chain`, `pnpm check:expo`, `EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1 pnpm exec expo-doctor`: supply-chain checks ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- `pnpm calibrate export|collect|eval` and `pnpm backup`: owner tools for the hosted project ([`docs/owner-runbook.md`](docs/owner-runbook.md)).
- Diagrams: edit a `docs/diagrams/*.json` source, then regenerate its page and SVG with archify ([`docs/architecture.md`](docs/architecture.md#regenerating-the-diagrams)).

## Where things live

- `src/app/`: Expo Router routes only. `src/ui/`, `src/i18n/`, `src/closet/`, `src/auth/`, `src/profile/`, `src/lib/`, `src/outfits/`, `src/stats/`, `src/account/`, `src/perf/`: the app's modules ([`docs/app.md`](docs/app.md)).
- `src/test/`: shared Jest helpers, never imported by app code.
- `supabase/functions/`: seven Edge Functions, each a runtime-neutral `handler.ts` plus a Deno-only `index.ts`; `_shared/` holds what they share, including `env.ts` (the startup env read), `http.ts` (replies, the caller, deadlines) and `guards.ts` ([`docs/api.md`](docs/api.md), [`docs/ai.md`](docs/ai.md)).
- `supabase/migrations/`, `supabase/tests/`, `supabase/seed.sql`, `supabase/config.toml`: schema, pgTAP, local seed and local config ([`docs/database.md`](docs/database.md), [`docs/local-stack.md`](docs/local-stack.md)).
- `modules/garment-cutout/`: the local native background-removal module ([its README](modules/garment-cutout/README.md)).
- `integration/`: Jest suites and mocks against the live local stack ([`docs/testing.md`](docs/testing.md#integration)).
- `scripts/`: repo tooling in TypeScript, run with Node's type stripping. `calibration/`: calibration fixtures; real `*.local.json` labels are gitignored.
- `.maestro/`: the end-to-end flows. `docs/`: the documents below; `docs/diagrams/` the archify sources and outputs; `docs/screenshots/` the README's screenshots.
- `locales/`: the localized iOS usage strings ([`docs/native-config.md`](docs/native-config.md)). `.github/`: CI, CodeQL, keep-alive and release workflows.

## Guardrails

- Never create or edit `ios/` or `android/`: they are generated and gitignored. Configure native behavior in `app.json` and config plugins ([`docs/native-config.md`](docs/native-config.md)).
- Add a native dependency with `pnpm expo install`, then rebuild with `pnpm expo run:ios` / `pnpm expo run:android`. Prefer Expo modules over third-party libraries, and check the available skills before adding a dependency.
- pnpm only (never npm, yarn or bun), and never weaken `pnpm-workspace.yaml`'s supply-chain settings ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Change `pnpm-lock.yaml` only through a local `pnpm install` or `pnpm update`, never by hand.
- `EXPO_PUBLIC_*` is inlined into the bundle, so no secrets: the Supabase URL and anon key, the two Google OAuth client ids, and the dev-only `EXPO_PUBLIC_PERF_FIXTURES_URL`. The service-role key never goes in `src/`.
- `app.json` never gains `ios.buildNumber` or `android.versionCode` (EAS owns them), and after `eas init` keeps only `owner` and `extra.eas.projectId` ([`docs/owner-runbook.md`](docs/owner-runbook.md#4-eas-project-and-builds)).
- Run `supabase secrets set` for the hosted project only from an empty directory, never from this repo ([`docs/owner-runbook.md`](docs/owner-runbook.md#setting-a-hosted-secret)).
- Edge Functions: no third-party imports, logic in `handler.ts` with `index.ts` Deno-only, and Storage only through `_shared/photoStore.ts` (a test enforces it).
- A schema change is a new migration (never edit a merged one), `pnpm db:types` and pgTAP ([`docs/database.md`](docs/database.md#new-table-checklist)).
- A cache lifetime change (`DEGRADED_TTL_MS`, `FOR_YOU_TTL_MS`) needs a new migration for `prune_expired_caches()`.
- Per-user kv keys follow `<name>.<id>[.<more>]`, so account deletion clears and refuses them ([`docs/app.md`](docs/app.md#account-privacy-srcaccount)).
- In `app.json`, `expo-image-picker` stays before `expo-camera`, and `cameraPermission: false` is never set ([`docs/native-config.md`](docs/native-config.md#permissions)).
- Google's `skip_nonce_check` stays `true` in `supabase/config.toml` and on the hosted project ([`docs/red-team.md`](docs/red-team.md#parked)).
- Nothing is deployed to the hosted project before the owner merges.

## Conventions

- Everything in English, except `src/i18n/es.ts` and the Spanish files the product needs: `locales/es.json`, `docs/privacy-policy.es.md` (change it with `docs/privacy-policy.md`),
  and For you's es store-search words (`supabase/functions/_shared/searchTerms.ts` and the archetypes' search phrases in `_shared/archetypes.ts`).
- `pnpm` pinned to an exact 11.x in `packageManager`; Node `>=24`.
- TypeScript strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit`: no build step, no `.js`/`.mjs` sources.
- Lint: typescript-eslint `strictTypeChecked`, `eslint-plugin-security` and `eslint-plugin-react-hooks` (not `eslint-config-expo`; see [`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Navigation is Expo Router: routes in `src/app/`, `Link`, `router` and `useLocalSearchParams` from `expo-router` (`https://docs.expo.dev/router/introduction.md`).
- App identity: display name "Dressing Room", slug `dressing-room-app`, scheme `dressingroom`, bundle id and package `com.aabv21.dressingroom`.
- Light-only appearance (`userInterfaceStyle: "light"`). The icon and splash are provisional: `assets/images/icon.svg` is the source of the five PNGs in `assets/images/`.
- Wear counts are spelled out ("never worn" / "1 wear" / "N wears"; es: "sin usar" / "1 uso" / "N usos"), never "N×".
- CTAs are anchored pill buttons, 48 pt tall minimum, with 44 pt hit targets everywhere.
- Comments:
  1. Say why, not what.
  2. One home per fact: flows and decisions live in `docs/`, and code links to them in one line.
  3. File headers at most 2 lines, JSDoc at most 5.
  4. Cite only what is in the repo: no mockup or spec numbers, plan ids or session names.
  5. A `NOTE:` is one line naming its ceiling, upgrade path and trigger.
  6. Lint suppressions go in `eslint.config.ts` path overrides, not inline.

## What to run for what change

| Change | Run (details in [`docs/testing.md`](docs/testing.md)) |
|---|---|
| Any change | `pnpm typecheck && pnpm lint && pnpm test` |
| An Edge Function | the gate, plus `pnpm test:int` against the local stack |
| A migration, RLS or a grant | `pnpm db:reset && pnpm db:test`, `pnpm db:types`, then `pnpm test:int` |
| Auth, profile or garment persistence | the gate plus `pnpm test:int` |
| A flow the Maestro suites cover | `pnpm e2e` on iOS and Android |
| A native config or plugin | `pnpm expo prebuild --clean` checks ([`docs/native-config.md`](docs/native-config.md)), then a rebuild |

## Docs to update with each kind of change

| Change | Update |
|---|---|
| An endpoint's request, response, status, auth or timeout | [`docs/api.md`](docs/api.md) |
| A prompt, model, Jev question, weight, quota or cost | [`docs/ai.md`](docs/ai.md) |
| A table, policy, grant, trigger or RPC | [`docs/database.md`](docs/database.md) and the data-model diagram |
| A component, request lifecycle, failure mode or design decision | [`docs/architecture.md`](docs/architecture.md) and its diagrams |
| A client module | [`docs/app.md`](docs/app.md) |
| A test suite | [`docs/testing.md`](docs/testing.md) |
| A new attack surface or defense | [`docs/red-team.md`](docs/red-team.md) |
| What the app collects or sends to a processor | both privacy policies |
| Local ports, secrets or mocks | [`docs/local-stack.md`](docs/local-stack.md) |
| An owner step or its status | [`docs/owner-runbook.md`](docs/owner-runbook.md) |
| A command or guardrail | this file |

## Documentation map

| Document | Covers |
|---|---|
| [`README.md`](README.md) | What the app does, screenshots, what works now, the quick start, tests, costs |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The pull request flow, the Android toolchain, supply-chain hardening, bumping pinned CI tools |
| [`docs/architecture.md`](docs/architecture.md) | Components, request lifecycles, data model, failures, security, scaling, decisions, regenerating the diagrams |
| [`docs/app.md`](docs/app.md) | The client modules under `src/`, including account deletion on the device |
| [`docs/api.md`](docs/api.md) | Every endpoint: functions, RPCs, tables, Storage, Auth, scheduled jobs, providers and their mocks |
| [`docs/ai.md`](docs/ai.md) | Prompts, schemas, Jev questions and weights, parsers, quotas, costs, the calibration math |
| [`docs/database.md`](docs/database.md) | Tables, enums, RLS, grants, storage rules, triggers and RPCs, migrations |
| [`docs/local-stack.md`](docs/local-stack.md) | The local Supabase stack, its ports, secrets and mocks |
| [`docs/native-config.md`](docs/native-config.md) | Permissions, plugin order, localized usage strings |
| [`docs/testing.md`](docs/testing.md) | Every test suite, pgTAP, the end-to-end flows and what CI runs |
| [`docs/red-team.md`](docs/red-team.md) | Attacks on the AI calls and the data, their defenses and tests, parked limits |
| [`docs/owner-runbook.md`](docs/owner-runbook.md) | The owner's steps with statuses, the EAS release config, backups and restore, calibration |
| [`docs/performance-gate.md`](docs/performance-gate.md) | The on-device scroll-performance protocol |
| [`docs/privacy-policy.md`](docs/privacy-policy.md), [`.es.md`](docs/privacy-policy.es.md) | The privacy policy, in English and Spanish |
| [`docs/diagrams/`](docs/diagrams/) | The four archify diagrams (system context, upload pipeline, rating sequence, data model): `*.json` sources, `*.html` pages, `*.svg` exports |

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request from `develop` into `main` titled `release: vX.Y.Z` (a summary may follow), merged with a merge commit.
  `.github/workflows/release.yml` then tags the merge commit `vX.Y.Z` and publishes a GitHub release with generated notes; a `release:` title without a version makes neither.
- Dependabot opens its pull requests against `develop`.
- Commits use the GitHub `noreply` address, never a personal email: set `git config user.email` to it in this clone.

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test` all pass locally.
- No secrets anywhere in the diff.
- Commits follow Conventional Commits, on a descriptively named branch.
- The docs are updated per "Docs to update with each kind of change".
