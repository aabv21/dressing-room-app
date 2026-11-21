export const colors = {
  ink: '#1d1b22',
  muted: '#6b6875',
  hairline: '#ece6fb',
  accent: '#7c3aed',
  commit: '#141317',
  // Selected labels and links; then the unfilled step-bar/slider track and the dashed outline.
  accentText: '#6d28d9',
  track: '#e6e0f5',
  dashed: '#cfc6e8',
  error: '#c0392b',
  // The processing / doubtful-attribute fill, and its border.
  tint: '#f3edff',
  tintBorder: '#d9c9ff',
  errorTint: '#fdecea',
  // The rating's reason marks: ✓ and !.
  positive: '#16a34a',
  warning: '#e11d48',
  // `positive` is for icons (3:1); as text it falls short of 4.5:1 on white, so green text uses this.
  positiveText: '#15803d',
  // Chips and segments when chosen; Build's active slot row takes it as its border.
  selected: '#7c3aed',
  // Opaque cards, chips and fields; `onFill` is text and icons on a dark or colored fill.
  surface: '#ffffff',
  onFill: '#ffffff',
  // White at an alpha over the screen gradient, by opacity percent: the frosted cards and the tab bar.
  glass: {
    0: 'rgba(255,255,255,0)',
    42: 'rgba(255,255,255,0.42)',
    60: 'rgba(255,255,255,0.6)',
    65: 'rgba(255,255,255,0.65)',
    70: 'rgba(255,255,255,0.7)',
    75: 'rgba(255,255,255,0.75)',
    80: 'rgba(255,255,255,0.8)',
    85: 'rgba(255,255,255,0.85)',
    90: 'rgba(255,255,255,0.9)',
    95: 'rgba(255,255,255,0.95)',
  },
  divider: '#eee9f8',
  // Behind an outfit's thumbnails: neutral, so a white garment doesn't vanish into a white or violet fill.
  thumbFill: '#f1f0f3',
  accentBorder: '#e3d8ff',
  accentBright: '#8b5cf6',
  inkSoft: '#4a4656',
  tabInactive: '#5f5b6b',
  shadow: '#3c1e78',
  // A swatch's edge, so a white or pale color still shows against a white chip.
  swatchEdge: 'rgba(0,0,0,0.15)',
  swatchEdgeSoft: 'rgba(0,0,0,0.12)',
  silhouetteOff: '#d9cdf7',
  // The light square of the checkerboard behind a cut-out photo.
  checker: '#f1eef7',
  // The CTA zone's fade over the light screen, from clear to the gradient's last stop.
  fadeClear: 'rgba(235,227,255,0)',
  // The camera's dark screen.
  night: '#0e0d12',
  nightClear: 'rgba(14,13,18,0)',
  mutedOnDark: '#bdbac6',
  viewfinder: '#cfc4b2',
  scrimDark: 'rgba(0,0,0,0.55)',
  // Behind a bottom sheet: dims the screen without hiding it.
  scrim: 'rgba(20,19,23,0.35)',
  hud: 'rgba(20,19,23,0.85)',
} as const;

/** Font sizes: `micro` is the floor for any text, `body` the reading size. */
export const fontSizes = {
  micro: 11,
  caption: 12,
  bodySmall: 13,
  body: 15,
  title: 17,
  headline: 22,
  display: 28,
} as const;

export const shadows = {
  card: '0 6px 18px rgba(60, 30, 120, 0.06)',
  goal: '0px 6px 18px rgba(60,30,120,0.08)',
  tabBar: '0px 12px 28px rgba(50,20,110,0.18)',
  tabLens: '0px 2px 8px rgba(80,40,160,0.16), inset 0px 1px 0px #ffffff',
} as const;

/** The selected card's halo. */
export const selectionRing = '0 0 0 3px rgba(124, 58, 237, 0.12)';

export const gradients = {
  background: ['#ffffff', '#f6f2ff', '#ebe3ff'],
  ai: ['#8b5cf6', '#6d28d9'],
} as const;

export const radii = {
  pill: 999,
  card: 20,
  cell: 12,
} as const;

// NOTE: an ad hoc 4pt scale covering the screens so far; upgrade path: replace it once a design scale is pinned.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/**
 * `maxFontSizeMultiplier` caps, only for text in fixed-size chrome, where growing without limit would
 * clip or push it out of its box. Content text is never capped: above `LARGE_TEXT_FONT_SCALE`
 * (`layout.ts`) side-by-side layouts stack or take a full row instead.
 */
export const textScale = {
  // Tab bar and segment labels: iOS shows them enlarged on a long press (the large content viewer).
  compact: 1.3,
  // Anchored CTA labels: the zone floats over the content, so it can't grow without covering it.
  cta: 1.5,
  // The score ring's number and caption; the ring grows with them up to the same factor.
  ring: 1.2,
  // Calendar day numbers and weekday letters, inside square day cells (beside a shrinking thumbnail).
  calendar: 1.45,
  // The badge and wear count over a closet thumbnail; iOS enlarges the cell on a long press, and a
  // screen reader reads both in its label.
  overlay: 1.3,
  // Decorative emoji beside text, which would otherwise take the width the text needs.
  emoji: 1.3,
  // The Welcome headline: a 900-weight hero breaks its longest word mid-word past this on a phone.
  hero: 2,
} as const;

export const layout = {
  tabBarHeight: 56,
  tabBarGap: 12,
  ctaGap: 10,
  ctaHeight: 48,
  // AnchoredCta's `zone` bottom padding; `useBottomChrome`'s chrome:'none' math subtracts it so the
  // button's own bottom edge, not the zone's, lands at exactly `insets.bottom + 22`.
  ctaZoneBottomPadding: 8,
  // AnchoredCta's `zone` padding above its buttons, where the fade starts.
  ctaZoneTopPadding: 22,
  minHitTarget: 44,
} as const;
