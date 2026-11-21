import * as Haptics from 'expo-haptics';

import { colors } from './theme';

/** A light impact for commits, a selection tick for choices; fire-and-forget, silent without haptics. */
export function tapHaptic(kind: 'selection' | 'commit'): void {
  try {
    const done = kind === 'commit' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync();
    done.catch(() => undefined);
  } catch {
    // No haptics on this device.
  }
}

/** The pressed look on iOS; Android gets `androidRipple` instead. */
export const pressedStyle = { opacity: 0.7 } as const;

export const androidRipple = { color: `${colors.ink}14` } as const;
