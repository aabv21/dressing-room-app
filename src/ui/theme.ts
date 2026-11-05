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

export const layout = {
  tabBarHeight: 56,
  tabBarGap: 12,
  ctaGap: 10,
  ctaHeight: 48,
  // AnchoredCta's `zone` wraps its buttons in `paddingBottom: ctaZoneBottomPadding` (the gradient
  // fade needs room above the button). `useBottomChrome`'s chrome:'none' math (layout.ts)
  // subtracts this so the button's own bottom edge — not the zone's — lands at exactly
  // `insets.bottom + 22`, per global-constraints.md / M2.
  ctaZoneBottomPadding: 8,
  // Global minimum tap target (global-constraints.md: "hit targets of at least 44").
  minHitTarget: 44,
} as const;
