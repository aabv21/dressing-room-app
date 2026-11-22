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
- **Never set `microphonePermission: false` on `expo-image-picker` or `expo-camera`.** Dictation
  (`expo-speech-recognition`) needs the microphone. On Android the picker's `false` calls
  `withBlockedPermissions(['android.permission.RECORD_AUDIO'])`, the same `tools:node="remove"`
  trap as the camera above; on iOS either plugin's `false` deletes `NSMicrophoneUsageDescription`
  in its Info.plist mod, which runs after `expo-speech-recognition` wrote the key into
  `ios.infoPlist`, so plugin order can't save it. Left unset, both keep the string that is already
  there.
- **`expo-speech-recognition`** (a community module; its 58.x line is the SDK 58 release) sits right
  after `expo-camera` with its `microphonePermission` and `speechRecognitionPermission` strings. It
  adds `RECORD_AUDIO` and a `<queries>` entry for the Google app's recognition service on Android.
  The app asks for both permissions only when the user taps a mic.
- **Localized usage strings.** `locales/en.json` and `locales/es.json` (from `app.json`'s
  `expo.locales`) hold `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSLocationWhenInUseUsageDescription`, `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` as `{"ios": {...}}`. `ios.infoPlist.CFBundleAllowMixedLocalizations: true`
  makes iOS pick the translated string instead of the base one. The camera and photo strings name both uses,
  the closet and comparing a piece with it ("Should I buy it?"); `app.json`'s plugin strings repeat
  the English ones (`scripts/__tests__/usage-strings.test.ts`).
- **Verify a change** with `pnpm expo prebuild -p ios --clean` (read `ios/<app>/Info.plist` and
  `ios/<app>/Supporting/<locale>.lproj/InfoPlist.strings`) and `pnpm expo prebuild -p android --clean`
  (look for `android.permission.CAMERA` in `android/app/src/main/AndroidManifest.xml`), then delete
  the generated folders.

## Notifications

- `expo-notifications` schedules the daily reminder, a local notification
  ([`app.md`](app.md#the-daily-reminder-srcreminder)), and receives the server's opt-in push notices
  ([`app.md`](app.md#notifications-from-the-app-srcpush)). Its plugin still sets
  `enableRemoteNotifications: false`, so the iOS build has no APNs (`aps-environment`) entitlement:
  a personal-team build can't sign one, so it stays off until the Apple account exists, and until
  then iOS's token fetch fails and Profile says notifications aren't available yet
  ([`owner-runbook.md`](owner-runbook.md#4-eas-project-and-builds)). `icon` (the monochrome
  adaptive-icon layer) and `color` style the Android status-bar icon.
- Android push needs FCM V1: `google-services.json` (public identifiers, safe to commit) under
  `android.googleServicesFile`, added with the file in the owner's Firebase step, never before it
  exists, and the service-account key uploaded with `eas credentials`, never committed. Until then
  `getExpoPushTokenAsync` fails and the app shows the same message.
- iOS needs no usage string for notifications; the system asks when the switch is turned on.
- On Android the library's own manifest adds `POST_NOTIFICATIONS` (Android 13+ asks for it, and
  only once a channel exists, so the app creates its `daily-reminder` channel, or the notices'
  `app-notices` channel, first) and
  `RECEIVE_BOOT_COMPLETED` (scheduled reminders survive a restart).
- No `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`: the `DAILY` trigger's default `bestEffort`
  delivery may arrive a few minutes late on some phones, which suits a morning reminder, and Google
  Play reserves exact alarms for alarm-clock and calendar apps.
- **Verify** with `pnpm exec expo config --type introspect` (the `_internal.modResults` Info.plist,
  entitlements and manifest), which writes nothing to `ios/` or `android/`; the library's manifest
  entries appear only in a build's merged manifest. Introspection starts from the existing
  `android/` and `ios/` files when they exist, so run it in a copy of the repo without them (with
  `node_modules` linked, calling `./node_modules/.bin/expo` rather than `pnpm exec`) to see what a
  clean prebuild makes. For the same reason a permission change needs a rebuild from a clean
  prebuild (`pnpm expo prebuild --clean`): a `tools:node="remove"` already in an old
  `AndroidManifest.xml` survives a plain `expo run:android`.

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
