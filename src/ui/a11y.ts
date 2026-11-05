import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Announces a message to screen readers on iOS (VoiceOver does not reliably pick up
 * `accessibilityLiveRegion`, which is Android-only — see the RN docs). Android relies on the
 * `accessibilityLiveRegion="polite"` prop already set on the error/status Text elements
 * themselves, so this is a no-op there to avoid announcing the same message twice.
 */
export function announceForAccessibility(message: string): void {
  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
