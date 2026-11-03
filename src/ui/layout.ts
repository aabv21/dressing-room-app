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

export function useBottomChrome(): {
  tabBarBottom: number;
  ctaBottom: number;
  contentPaddingBottom: number;
} {
  const insets = useSafeAreaInsets();
  const tabBarBottom = insets.bottom + layout.tabBarGap;
  const ctaBottom = tabBarBottom + layout.tabBarHeight + layout.ctaGap;
  const contentPaddingBottom = ctaBottom + layout.ctaHeight + 24;
  return { tabBarBottom, ctaBottom, contentPaddingBottom };
}
