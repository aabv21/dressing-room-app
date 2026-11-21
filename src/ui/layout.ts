import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MessageKey } from '../i18n';
import type { LucideIcon } from 'lucide-react-native';
import { House, Layers, Shirt, ShoppingBag, User } from 'lucide-react-native';

import { layout } from './theme';

export type TabRoute = 'index' | 'closet' | 'build' | 'for-you' | 'profile';

export const TABS: readonly { route: TabRoute; labelKey: MessageKey; icon: LucideIcon }[] = [
  { route: 'index', labelKey: 'tabs.today', icon: House },
  { route: 'closet', labelKey: 'tabs.closet', icon: Shirt },
  { route: 'build', labelKey: 'tabs.build', icon: Layers },
  { route: 'for-you', labelKey: 'tabs.forYou', icon: ShoppingBag },
  { route: 'profile', labelKey: 'tabs.profile', icon: User },
] as const;

export type ScreenChrome = 'tabs' | 'none';

/** `chrome: 'none'` (no tab bar: auth, onboarding) puts the CTA button at `insets.bottom + 22`. */
export function useBottomChrome(chrome: ScreenChrome = 'tabs'): {
  tabBarBottom: number;
  ctaBottom: number;
  contentPaddingBottom: number;
} {
  const insets = useSafeAreaInsets();
  if (chrome === 'none') {
    // The zone sits at `bottom: ctaBottom` and pads `ctaZoneBottomPadding` inside, so the button's
    // bottom edge is at `ctaBottom + ctaZoneBottomPadding`; hitting `insets.bottom + 22` means subtracting it.
    const ctaBottom = insets.bottom + 22 - layout.ctaZoneBottomPadding;
    return { tabBarBottom: ctaBottom, ctaBottom, contentPaddingBottom: ctaZoneTop(ctaBottom) };
  }
  const tabBarBottom = insets.bottom + layout.tabBarGap;
  const ctaBottom = tabBarBottom + layout.tabBarHeight + layout.ctaGap;
  return { tabBarBottom, ctaBottom, contentPaddingBottom: ctaZoneTop(ctaBottom) };
}

/** Where the CTA fade starts: content padded to it never leaves its last row under the backdrop. */
function ctaZoneTop(ctaBottom: number): number {
  return ctaBottom + layout.ctaZoneBottomPadding + layout.ctaHeight + layout.ctaZoneTopPadding;
}

/**
 * The system text scale above which side-by-side layouts stack or take a full row, so text keeps
 * growing without breaking mid-word. Between iOS's largest standard size (~1.35x) and its first
 * accessibility size.
 */
export const LARGE_TEXT_FONT_SCALE = 1.5;

export function useLargeText(): boolean {
  return useWindowDimensions().fontScale > LARGE_TEXT_FONT_SCALE;
}
