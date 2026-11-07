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
    const contentPaddingBottom = ctaBottom + layout.ctaHeight + 24;
    return { tabBarBottom: ctaBottom, ctaBottom, contentPaddingBottom };
  }
  const tabBarBottom = insets.bottom + layout.tabBarGap;
  const ctaBottom = tabBarBottom + layout.tabBarHeight + layout.ctaGap;
  const contentPaddingBottom = ctaBottom + layout.ctaHeight + 24;
  return { tabBarBottom, ctaBottom, contentPaddingBottom };
}
