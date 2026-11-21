import * as Haptics from 'expo-haptics';

import { colors } from './theme';

/**
 * A light impact for commits, a selection tick for choices, a success notification for a result
 * (the rating); fire-and-forget, silent without haptics.
 */
export function tapHaptic(kind: 'selection' | 'commit' | 'success'): void {
  try {
    let done: Promise<void>;
    if (kind === 'success') done = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'commit') done = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else done = Haptics.selectionAsync();
    done.catch(() => undefined);
  } catch {
    // No haptics on this device.
  }
}

/** The pressed look on iOS; Android gets `androidRipple` instead. */
export const pressedStyle = { opacity: 0.7 } as const;

export const androidRipple = { color: `${colors.ink}14` } as const;
