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

/**
 * `chrome: 'none'` is for screens with no tab bar (auth, onboarding — mockup 03): their CTA is
 * anchored at the bottom with its button at `insets.bottom + 22`. `chrome: 'tabs'` (default) keeps
 * the existing tab-bar-aware offsets.
 */
export function useBottomChrome(chrome: ScreenChrome = 'tabs'): {
  tabBarBottom: number;
  ctaBottom: number;
  contentPaddingBottom: number;
} {
  const insets = useSafeAreaInsets();
  if (chrome === 'none') {
    // AnchoredCta's `zone` is `position: 'absolute', bottom: ctaBottom` with no explicit height,
    // so its own bottom edge sits exactly `ctaBottom` above the screen bottom; the zone then adds
    // `paddingBottom: ctaZoneBottomPadding` *inside* that, pushing the button row up by that much
    // further — so the button's own rendered bottom edge ends up at `ctaBottom +
    // ctaZoneBottomPadding`, not `ctaBottom` itself (subtracting instead would land the button
    // about twice as high as intended). Solving for the target
    // (`insets.bottom + 22`) means `ctaBottom` here must be that much *lower*.
    const ctaBottom = insets.bottom + 22 - layout.ctaZoneBottomPadding;
    return { tabBarBottom: ctaBottom, ctaBottom, contentPaddingBottom: ctaZoneTop(ctaBottom) };
  }
  const tabBarBottom = insets.bottom + layout.tabBarGap;
  const ctaBottom = tabBarBottom + layout.tabBarHeight + layout.ctaGap;
  return { tabBarBottom, ctaBottom, contentPaddingBottom: ctaZoneTop(ctaBottom) };
}

/**
 * The top of AnchoredCta's zone, where its fade starts: content padded down to it ends above the
 * fade, so the last row (Build's grid, a long form) is never left under the buttons' backdrop.
 */
function ctaZoneTop(ctaBottom: number): number {
  return ctaBottom + layout.ctaZoneBottomPadding + layout.ctaHeight + layout.ctaZoneTopPadding;
}

/**
 * The system text scale (iOS Dynamic Type, Android font scale) above which side-by-side layouts
 * stack or take a full row, so their content text can keep growing without breaking mid-word. It
 * sits between iOS's largest standard size (about 1.35x) and its first accessibility size.
 */
export const LARGE_TEXT_FONT_SCALE = 1.5;

/** Whether the system text scale is above `LARGE_TEXT_FONT_SCALE`. */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale > LARGE_TEXT_FONT_SCALE;
}
