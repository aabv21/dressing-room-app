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
