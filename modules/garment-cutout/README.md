# garment-cutout

A local Expo native module, autolinked from `modules/` (no npm package), that removes a garment
photo's background on the device and writes a cropped PNG with alpha to the caches directory.

- **iOS 17+:** Vision foreground instance masks. **Android:** ML Kit subject segmentation.
- The source is decoded at most 2048 px on its longest side (EXIF applied) before segmenting, so
  48 MP photos stay within memory.
- The work runs off the module queue other async native calls share: a global queue on iOS, the IO
  dispatcher on Android.
- On Android, `android/src/main/AndroidManifest.xml` asks Play services to download the
  segmentation model at install time; until it's there, `cutOut` requests it again and resolves
  `null`.
- `index.ts` loads the module with `requireOptionalNativeModule`, so a build without it gets `null`.

App code calls it only through `src/closet/upload/cutout.ts`'s `cutOutGarment`, which never throws
and returns `null` whenever there is no cut-out; the original photo is then kept. Native changes need
a rebuild (`pnpm expo run:ios` / `pnpm expo run:android`), not just Fast Refresh. The live checks on
real phones are in [`docs/owner-runbook.md`](../../docs/owner-runbook.md#5-live-checks-on-the-phone).
