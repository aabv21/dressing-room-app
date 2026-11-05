import { renderHook } from '@testing-library/react-native';

import { useBottomChrome } from '../layout';
import { layout } from '../theme';

// Under the jest-expo project's safe-area-context mock (jest.setup.ts), useSafeAreaInsets()
// resolves all-zero insets with no provider, so `insets.bottom` is 0 here.
describe('useBottomChrome', () => {
  test("chrome 'none': the rendered CTA button's own bottom edge lands at insets.bottom + 22 (M2)", async () => {
    const { result } = await renderHook(() => useBottomChrome('none'));

    // AnchoredCta's `zone` is absolutely positioned with `bottom: ctaBottom` and no explicit
    // height, so the zone's own bottom edge sits exactly `ctaBottom` above the screen bottom; the
    // zone's `paddingBottom: ctaZoneBottomPadding` then pushes the button row up by that much
    // further *inside* the zone — so the button's own rendered bottom edge ends up at `ctaBottom +
    // ctaZoneBottomPadding`, which must equal `insets.bottom + 22` (here, insets.bottom is 0 under
    // the mock) — not `ctaBottom` itself, and not `ctaBottom - ctaZoneBottomPadding` (round 1's
    // sign error, which doubled the padding instead of cancelling it).
    const buttonBottomEdge = result.current.ctaBottom + layout.ctaZoneBottomPadding;
    expect(buttonBottomEdge).toBe(0 + 22);
  });

  test("chrome 'tabs' keeps the existing tab-bar-aware offsets", async () => {
    const { result } = await renderHook(() => useBottomChrome('tabs'));

    expect(result.current.tabBarBottom).toBe(0 + layout.tabBarGap);
    expect(result.current.ctaBottom).toBe(result.current.tabBarBottom + layout.tabBarHeight + layout.ctaGap);
  });
});
