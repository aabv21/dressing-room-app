# Native configuration

`ios/` and `android/` are generated at prebuild (Continuous Native Generation) and gitignored: never
create or edit them by hand. Native behavior lives in `app.json` and its config plugins.

## Permissions

- **Plugin order is load-bearing.** In `app.json`'s `plugins`, `expo-image-picker` must stay
  **before** `expo-camera`. Each permissions-owning plugin's Info.plist mod runs in array order, and
  the later one's non-`false` value wins (`@expo/config-plugins`' `applyPermissions`:
  `infoPlist[key] = permissions[key] || infoPlist[key] || defaultDescription`), so `expo-camera` must
  run last for its real `NSCameraUsageDescription` to stick.
- **Never set `cameraPermission: false` on `expo-image-picker`.** On Android that option also calls
  `withBlockedPermissions(['android.permission.CAMERA'])`, which adds a `tools:node="remove"` manifest
  entry that wins over every other plugin's `uses-permission` at manifest merge, `expo-camera`'s
  included: the built app loses the camera permission. Leave it unset; `expo-camera`'s later mod
  overwrites the picker's default iOS string anyway.
- **Localized usage strings.** `locales/en.json` and `locales/es.json` (from `app.json`'s
  `expo.locales`) hold `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` and
  `NSLocationWhenInUseUsageDescription` as `{"ios": {...}}`. `ios.infoPlist.CFBundleAllowMixedLocalizations: true`
  makes iOS pick the translated string instead of the base one.
- **Verify a change** with `pnpm expo prebuild -p ios --clean` (read `ios/<app>/Info.plist` and
  `ios/<app>/Supporting/<locale>.lproj/InfoPlist.strings`) and `pnpm expo prebuild -p android --clean`
  (look for `android.permission.CAMERA` in `android/app/src/main/AndroidManifest.xml`), then delete
  the generated folders.

## Notifications

- `expo-notifications` schedules the daily reminder, a local notification only
  ([`app.md`](app.md#the-daily-reminder-srcreminder)). Its plugin sets
  `enableRemoteNotifications: false`, so the iOS build has no APNs (`aps-environment`) entitlement
  and needs no push setup with Apple, FCM or Expo Push; `icon` (the monochrome adaptive-icon layer)
  and `color` style the Android status-bar icon.
- iOS needs no usage string for notifications; the system asks when the switch is turned on.
- On Android the library's own manifest adds `POST_NOTIFICATIONS` (Android 13+ asks for it, and
  only once a channel exists, so the app creates its `daily-reminder` channel first) and
  `RECEIVE_BOOT_COMPLETED` (scheduled reminders survive a restart).
- No `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`: the `DAILY` trigger's default `bestEffort`
  delivery may arrive a few minutes late on some phones, which suits a morning reminder, and Google
  Play reserves exact alarms for alarm-clock and calendar apps.
- **Verify** with `pnpm exec expo config --type introspect` (the `_internal.modResults` Info.plist,
  entitlements and manifest), which writes nothing to `ios/` or `android/`; the library's manifest
  entries appear only in a build's merged manifest.

## Text to speech

`expo-speech` (Listen) has no config plugin and asks for no permission: it uses the voices
installed on the phone. On an iPhone in silent mode it makes no sound.

## Sign-in configuration

- `@react-native-google-signin/google-signin`'s plugin sets `iosUrlScheme` to the iOS OAuth client's
  reversed id. A new iOS client means a new scheme and a native rebuild.
- `expo-apple-authentication` provides Sign in with Apple on iOS.

## Native dependencies

Add a package with native code with `pnpm expo install <package>` (it resolves the SDK-compatible
version), then rebuild with `pnpm expo run:ios` / `pnpm expo run:android`; Fast Refresh doesn't pick
up native changes. The local module `modules/garment-cutout` is documented in
[its README](../modules/garment-cutout/README.md).
