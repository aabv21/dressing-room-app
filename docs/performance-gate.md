# Performance gate: scroll performance on the owner's iPhone

**Status: pending.** This is the protocol for the on-device go/no-go call on Expo (the design
spec's performance gate, §5.1). It is written ahead of the owner's device session so the session
itself is just execution: build, measure, record, decide. Steps 2–4 (run the session, decide, commit the result) happen later and
are not part of this document's authoring.

## What the gate measures

With `EXPO_PUBLIC_PERF_FIXTURES_URL` set at build time, the Closet tab (`src/app/(tabs)/closet.tsx`)
renders 500 fixture thumbnails in a `ClosetGrid` (FlashList + expo-image), with:

- a frame-stats HUD (`src/perf/PerfHud.tsx`, `src/perf/useFrameStats.ts`) overlaid at the top of the
  screen, below the status bar. It shows two lines:
  ```
  <frames> frames · <dropped> dropped (<ratio>%)
  p95 <p95> ms · median <median> ms ≈ <hz> Hz
  ```
  - **Tap** the HUD: resets the stats (frame count back to 0).
  - **Long-press** the HUD: clears expo-image's memory **and** disk caches, then resets the stats.
    It shows a brief confirmation message in place of the stats line
    ("Image cache cleared · stats reset", or a failure message if the clear didn't succeed).
  - The HUD only counts frames while the grid is actively scrolling (`onScrollActiveChange`) — it
    is not a free-running FPS counter.
- the Gallery and Burst mode CTAs, both present but disabled (fixture mode has no real upload flow).

The refresh rate (`Hz`) in the HUD is **inferred from the measured median frame time**, not read
from the OS — e.g. a median near 8.3 ms infers 120 Hz, near 16.7 ms infers 60 Hz. Use whatever the
HUD reports for that device, not an assumption from the model name.

## Prerequisites

1. iPhone connected to the Mac by USB and trusted (tap "Trust" on the iPhone if prompted).
2. Developer Mode on, on the iPhone: Settings → Privacy & Security → Developer Mode → on (requires
   a restart if just enabled).
3. Xcode signing configured with the owner's Apple Developer team — see
   https://expo.fyi/setup-xcode-signing.
4. The Mac and the iPhone on the **same Wi-Fi network**.

## Build steps

Run these from the repo root, in order.

1. Generate the fixture thumbnails (once; skip if `.perf-fixtures/` already has 500 files):
   ```bash
   pnpm perf:generate
   ```
2. Start the fixture server and keep it running for the whole session:
   ```bash
   pnpm perf:serve
   ```
   This prints **every LAN IPv4 address on the Mac, labeled by network interface** — not just one.
   Pick the address for the **Wi-Fi interface** (usually `en0` on a Mac), matching the Wi-Fi network
   the iPhone is on. Ignore addresses from VPN, bridge, or Ethernet interfaces (e.g. `utun*`,
   `bridge*`, `en1`/`en2` if those are USB/Thunderbolt Ethernet) even if they appear in the list —
   using one of those will make the iPhone unable to reach the fixture server.
3. In a second terminal, build and install a **Release** build with the fixture URL baked in (the
   env var is inlined into the JS bundle at build time, so it must be present during this command —
   not set afterward):
   ```bash
   EXPO_PUBLIC_PERF_FIXTURES_URL=http://<en0-address>:8787 pnpm expo run:ios --device --configuration Release
   ```
   A Release build matters: dev builds run slower JavaScript and would make the gate measure the
   wrong thing.

## First launch: Local Network permission

On the first fixture fetch, iOS shows a **"Dressing Room would like to find and connect to devices
on your local network"** permission prompt (the app declares `NSLocalNetworkUsageDescription` for
this). **Grant it.** If denied, thumbnails never load and the HUD will show dropped frames that
reflect a permission problem, not scroll performance — restart the measurement from a clean launch
after fixing the permission (Settings → Dressing Room → Local Network → on).

## Measurement passes

All scrolling must be **real finger flings** on the device — not a programmatic/automated scroll.
(A programmatic scroll fires a scroll-end event per discrete step, which does not exercise the
grid the same way a real fling's momentum and deceleration do.)

### Cold pass (true cold start)

A true cold pass needs the disk cache actually empty, and expo-image's disk cache survives app
reinstalls — so clearing it is a separate, explicit step, not something a fresh install does for
you:

1. Launch the app, go to the Closet tab.
2. Grant the Local Network permission if this is the very first launch (see above).
3. **Long-press the HUD** to clear expo-image's memory and disk caches (confirms with a message)
   and reset the stats.
4. **Force-quit the app** (swipe up in the app switcher) and **relaunch** it.
5. Go to the Closet tab. Fling from the top to the bottom of the grid in about 10 seconds, using
   real finger flings.
6. Record the full HUD line (both lines: frames/dropped/ratio and p95/median/Hz) and note whether
   any cell stayed visibly blank (placeholder, no image) for more than 1 second.

### Warm passes (×3)

1. Scroll back to the top of the grid.
2. Tap the HUD to reset the stats.
3. Fling from top to bottom in about 10 seconds, real finger flings.
4. Record the full HUD line.
5. Repeat for a total of **3 warm passes**.

### Slow-drag check

1. Reset the HUD.
2. Perform one slow drag on the grid and **release without a fling** (let the list stop exactly
   where the finger lifts, no momentum).
3. Confirm the HUD's frame count stops increasing once the finger lifts (the HUD only counts active
   scrolling, not idle time). Note pass/fail.

## Pass criteria (decided now, before measuring)

- Every **warm** pass: `droppedRatio ≤ 0.05` **and** `p95 ≤ 1.5 × the device's frame interval`
  — i.e. **p95 ≤ 12.5 ms at 120 Hz** or **p95 ≤ 25 ms at 60 Hz**, using the Hz the HUD itself infers
  for that device (not an assumed spec value).
- **Cold** pass: no cell blank for more than 1 s.
- The owner sees **no visible jank** during any pass (subjective call, recorded as part of the
  verdict).
- Slow-drag check: the HUD stops counting frames once the finger lifts.

If any criterion fails, go to **Decision → If it fails** below before writing anything else down
as final.

## Results table (fill in during the session)

| Field | Value |
|---|---|
| iPhone model | |
| iOS version | |
| Inferred refresh rate (from HUD `Hz`) | |
| Cold pass — full HUD line | |
| Cold pass — any cell blank > 1 s? | |
| Warm pass 1 — full HUD line | |
| Warm pass 2 — full HUD line | |
| Warm pass 3 — full HUD line | |
| Slow-drag check — HUD stopped counting on release? | |
| Owner verdict (visible jank: yes/no, comments) | |
| Decision (pass / fail / pass after optimization) | |

## Decision

- **If it passes:** set the README status line to "Performance gate passed on `<model>`", fill in
  the results table above, then commit; the app keeps building on Expo.
- **If it fails:** try these optimizations, once each, in order, then re-run the warm passes (no
  need to redo the cold pass unless the change affects loading):
  1. Smaller thumbnails (192 px instead of 256 px).
  2. `cachePolicy="memory-disk"` on the thumbnail `Image` components.
  3. Remove the `transition` on the thumbnail `Image` components.
  4. Tune FlashList's `drawDistance`.

  Re-measure after each change (or after all four, owner's call on timeboxing). If it still fails
  after trying these, **stop**. Record the final result in the table above and bring the owner the
  native SwiftUI + Jetpack Compose alternative (spec §5.1) before building anything further.

**Deferred to the integration session:** the same protocol on a family Android phone, if
one is available, using `pnpm expo run:android --device --variant release`.
