import { LogBox, Platform, Settings } from 'react-native';

/**
 * True when Maestro launched the app for the end-to-end flows: their `launchApp` passes `-e2e 1`,
 * which iOS puts in the app's user defaults (`Settings`). Only checked in a dev build.
 * NOTE: iOS only, since Android has no launch-argument defaults; Android flows would need another
 * signal (an intent extra read by a native module).
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
 * In a dev build launched by the flows, hides LogBox's warning toasts: they sit over the anchored
 * CTAs, so a flow's tap would open the debugger instead of pressing the button.
 */
export function quietDevToastsForE2e(): void {
  if (__DEV__ && isE2eLaunch()) {
    LogBox.ignoreAllLogs(true);
  }
}
