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
// mockups seen so far. Upgrade path: replace with spec-pinned values once Task 4's
// mockup pass defines them.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
