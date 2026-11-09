import { renderHook } from '@testing-library/react-native';

import { LARGE_TEXT_FONT_SCALE, useBottomChrome, useLargeText } from '../layout';
import { layout } from '../theme';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// Under the jest-expo project's safe-area-context mock (jest.setup.ts), useSafeAreaInsets()
// resolves all-zero insets with no provider, so `insets.bottom` is 0 here.
describe('useBottomChrome', () => {
  test("chrome 'none': the rendered CTA button's own bottom edge lands at insets.bottom + 22", async () => {
    const { result } = await renderHook(() => useBottomChrome('none'));

    // AnchoredCta's `zone` is absolutely positioned with `bottom: ctaBottom` and no explicit
    // height, so the zone's own bottom edge sits exactly `ctaBottom` above the screen bottom; the
    // zone's `paddingBottom: ctaZoneBottomPadding` then pushes the button row up by that much
    // further *inside* the zone — so the button's own rendered bottom edge ends up at `ctaBottom +
    // ctaZoneBottomPadding`, which must equal `insets.bottom + 22` (here, insets.bottom is 0 under
    // the mock) — not `ctaBottom` itself, and not `ctaBottom - ctaZoneBottomPadding` (that sign
    // error doubles the padding instead of cancelling it).
    const buttonBottomEdge = result.current.ctaBottom + layout.ctaZoneBottomPadding;
    expect(buttonBottomEdge).toBe(0 + 22);
  });

  test("chrome 'tabs' keeps the existing tab-bar-aware offsets", async () => {
    const { result } = await renderHook(() => useBottomChrome('tabs'));

    expect(result.current.tabBarBottom).toBe(0 + layout.tabBarGap);
    expect(result.current.ctaBottom).toBe(result.current.tabBarBottom + layout.tabBarHeight + layout.ctaGap);
  });
});

describe('useLargeText', () => {
  test.each([
    [1, false],
    [1.35, false],
    [LARGE_TEXT_FONT_SCALE, false],
    [1.65, true],
    [2, true],
    [3.1, true],
  ])('fontScale %d → %s', async (fontScale, expected) => {
    mockWindow.fontScale = fontScale;
    const { result } = await renderHook(() => useLargeText());
    expect(result.current).toBe(expected);
  });
});
