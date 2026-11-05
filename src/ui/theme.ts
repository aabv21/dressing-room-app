export const colors = {
  ink: '#1d1b22',
  muted: '#6b6875',
  hairline: '#ece6fb',
  accent: '#7c3aed',
  commit: '#141317',
} as const;

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
