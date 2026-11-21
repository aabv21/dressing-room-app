import { LogBox, Platform, Settings } from 'react-native';

/**
 * Maestro's `launchApp` passes `-e2e 1`, which iOS puts in the user defaults (`Settings`); dev builds only.
 * NOTE: iOS only (Android flows rely on no warnings being logged); upgrade: an intent extra read natively.
 */
export function isE2eLaunch(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return String(Settings.get('e2e')) === '1';
  } catch {
    // No native settings module (e.g. under Jest): not a Maestro launch.
    return false;
  }
}

/**
 * LogBox's toasts sit over the anchored CTAs, so a flow's tap would open the debugger instead.
 * `ignoreAllLogs` hides error toasts too; errors still reach Metro's log, so read it when a flow fails.
 */
export function quietDevToastsForE2e(): void {
  if (__DEV__ && isE2eLaunch()) {
    LogBox.ignoreAllLogs(true);
  }
}
