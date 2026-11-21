# Contributing

[`AGENTS.md`](AGENTS.md) is the working guide for humans and AI agents alike: the commands, the
guardrails, the conventions, the documentation map and the Definition of done.

1. Branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change with its tests, and run the Definition of done locally.
3. Open a pull request into `develop`, titled in [Conventional Commits](https://www.conventionalcommits.org/) form. It's squash-merged once CI is green.

Releases are pull requests from `develop` into `main` titled `release: vX.Y.Z` and merged with a merge commit; `.github/workflows/release.yml` then tags that commit and publishes the GitHub release. Report security issues privately, as [`SECURITY.md`](SECURITY.md) describes.

## Android toolchain

`pnpm android` and `pnpm expo run:android` need:

- `JAVA_HOME` at Java 17 (Homebrew's `openjdk@17`); Gradle fails on Android Studio's bundled Java 25.
- The SDK at `ANDROID_HOME` or `~/Library/Android/sdk`, with NDK 27.1.12297006 and CMake 3.22.1.
- An emulator on a Google Play system image, since Play services provide ML Kit's segmentation
  model. This repo uses a Pixel 9 AVD on the `android-36` `google_apis_playstore` arm64 image,
  started with `-gpu host`.

## Supply-chain hardening

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x` version. `pnpm-workspace.yaml`
holds the settings pnpm 11 reads instead of `.npmrc`:

- `minimumReleaseAge: 4320`: no package version (transitive ones included) published less than 3
  days ago installs, so a compromised release has a window to be caught and pulled.
- `minimumReleaseAgeExclude: []`: nothing is exempt from the age gate.
- `trustPolicy: no-downgrade`: an install fails if a package's trust evidence (provenance, trusted
  publishing) regresses from an earlier release.
- `blockExoticSubdeps: true`: only a direct dependency may resolve from a git or tarball URL.
- `strictDepBuilds: true` with `dangerouslyAllowAllBuilds: false`: a dependency's install script
  fails the install unless `allowBuilds` approves it.
- `engineStrict: true`: a dependency whose `engines` excludes this repo's Node fails the install.
- `allowBuilds` lists only packages a real install proved need their build script, each with a
  reason: `@parcel/watcher` and `unrs-resolver` (Jest's native watcher and resolver).

`pnpm check:supply-chain` (`scripts/check-supply-chain.ts`, run in CI's quality job) fails if
`pnpm-workspace.yaml` loses `trustPolicy: no-downgrade` or `minimumReleaseAge`, or gains a
`trustPolicyExclude`.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`), run
the gate, and commit both files together. CI's `pnpm install --frozen-lockfile` installs exactly the
lockfile and does **not** re-check `trustPolicy` or `minimumReleaseAge`, so a lockfile change must
always come from a local `pnpm install` or `pnpm update` with these settings on, never a hand-edited
or externally generated lockfile. When `minimumReleaseAge` refuses a version, wait it out or pin an
older compatible one. Packages with native code go through `pnpm expo install <package>`.

**`eslint-config-expo` is deliberately not used.** It pulls in `eslint-import-resolver-typescript`,
whose only SDK-58-compatible version had a trust-evidence regression this repo's `trustPolicy`
caught, with no in-range version to fall back on. `eslint.config.ts` composes `typescript-eslint`'s
`strictTypeChecked`, `eslint-plugin-security`'s `recommended` and `eslint-plugin-react-hooks`'
`recommended-latest` directly instead.

**`pnpm check:expo` (`expo install --check`) is informational, not a CI gate.** It compares every
package against the newest release on npm, with no awareness of `minimumReleaseAge`, so it flags any
package whose newer release is still too young to install. Run it (or `pnpm expo install --fix`)
during a deliberate Expo SDK upgrade, once the versions have cleared the 3-day gate.

**expo-doctor runs in CI without its SDK version check.** CI's quality job runs the locked
`pnpm exec expo-doctor` with `EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1`: that check is the same
comparison as `pnpm check:expo` and would fail whenever a patch is still inside the age gate. Every
other check is a gate. Some call Expo's servers; if a network error ever makes them flaky, set
`EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS=1` on that step.

## Bumping pinned CI tools and zizmor by hand

Dependabot bumps the `uses:` actions (pinned by commit SHA with a version comment) and npm packages,
both against `develop`. Three CI tools sit outside its reach and are bumped by hand:

- **gitleaks** (`.github/workflows/ci.yml`'s security job) and **actionlint** (the actions job) run
  as Docker images pinned by tag and digest, `zricethezav/gitleaks:<tag>@sha256:<digest>` and
  `rhysd/actionlint:<tag>@sha256:<digest>`. To bump one, pick the new release tag, read its digest
  (`docker buildx imagetools inspect <image>:<tag>`, the index digest on the first lines), and
  replace both the tag and the digest in the `run:` line.
- **zizmor** installs with `pip install --require-hashes -r .github/zizmor-requirements.txt`. To bump
  it, change the version in that file, then fetch every file's sha256 from PyPI's JSON API
  (`https://pypi.org/pypi/zizmor/<version>/json`, each `urls[].digests.sha256`: every platform
  wheel and the sdist) and replace the `--hash` lines with them. zizmor declares no runtime
  dependencies, so it is the only entry.

Then open a `chore:` pull request; CI's actions job runs the new zizmor and actionlint against the
workflows.
