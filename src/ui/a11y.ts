import { AccessibilityInfo, Platform } from 'react-native';

/**
 * iOS only: `accessibilityLiveRegion` is Android-only, and Android already hears the Texts' polite
 * live regions, so announcing there would say it twice.
 */
export function announceForAccessibility(message: string): void {
  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
