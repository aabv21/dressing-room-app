export const colors = {
  ink: '#1d1b22',
  muted: '#6b6875',
  hairline: '#ece6fb',
  accent: '#7c3aed',
  commit: '#141317',
  // Mockup 03: the deeper violet for selected labels/links, the unfilled step-bar/slider track and
  // the optional section's dashed outline.
  accentText: '#6d28d9',
  track: '#e6e0f5',
  dashed: '#cfc6e8',
  error: '#c0392b',
  // Mockup 02's `.g.proc` / mockup 02 review's `.doubt` fill, and its border.
  tint: '#f3edff',
  tintBorder: '#d9c9ff',
  errorTint: '#fdecea',
  // Mockup 01 screen 3's reason marks: `.ok` (✓) and `.warn` (!).
  positive: '#16a34a',
  warning: '#e11d48',
  // `positive` is for icons (3:1 is enough there); as text it falls short of 4.5:1 on white, so
  // green text uses this deeper shade.
  positiveText: '#15803d',
} as const;

/** Mockup 03's selected-card halo (`box-shadow: 0 0 0 3px rgba(124,58,237,.12)`). */
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

// NOTE: no spacing scale is pinned in the spec yet; this 4pt-based scale covers the
// mockups seen so far. Upgrade path: replace with spec-pinned values once the spec
// defines them.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/**
 * `maxFontSizeMultiplier` caps for text in fixed-size chrome, where growing without limit would clip
 * or push it out of its box. Everything else grows with the system text size.
 */
export const textScale = {
  // Tab bar and segment labels: iOS shows them enlarged on a long press (the large content viewer).
  compact: 1.3,
  // Chart labels and values beside a bar.
  chart: 1.5,
  // Anchored CTA labels: the zone floats over the content, so it can't grow without covering it.
  cta: 1.5,
  // The score ring's number and caption, inside a fixed 112 pt ring.
  ring: 1.2,
  // Calendar day numbers, inside square day cells.
  calendar: 1.3,
} as const;

export const layout = {
  tabBarHeight: 56,
  tabBarGap: 12,
  ctaGap: 10,
  ctaHeight: 48,
  // AnchoredCta's `zone` wraps its buttons in `paddingBottom: ctaZoneBottomPadding` (the gradient
  // fade needs room above the button). `useBottomChrome`'s chrome:'none' math (layout.ts)
  // subtracts this so the button's own bottom edge — not the zone's — lands at exactly
  // `insets.bottom + 22`.
  ctaZoneBottomPadding: 8,
  // Minimum tap target everywhere in the app (44pt).
  minHitTarget: 44,
} as const;
