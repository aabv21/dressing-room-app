// Shared garment catalog: the closet domain's enum tuples, their TS union types, and the
// category/slot/availability derivations the app and the extraction function both need.
//
// No imports, and nothing Deno- or Node-only: this file is imported both by Supabase Edge
// Functions (Deno) via its own path and by the Expo app (Node/Metro) via `src/closet/catalog.ts`'s
// re-export, so it must run unmodified in both runtimes.
//
// Enum values here must match the Postgres enums in
// `supabase/migrations/20261108021700_garments.sql` exactly — `src/closet/__tests__/catalog.test.ts`
// compares every tuple against `Constants.public.Enums.*` in the generated
// `src/lib/database.types.ts`.

export const GARMENT_CATEGORIES = [
  // tops
  't_shirt',
  'blouse',
  'shirt',
  'polo',
  'tank_top',
  'sweater',
  'hoodie',
  'cardigan',
  // bottoms
  'pants',
  'jeans',
  'shorts',
  'skirt',
  'leggings',
  // one-piece
  'dress',
  'jumpsuit',
  // outerwear
  'jacket',
  'blazer',
  'coat',
  'vest',
  // shoes
  'sneakers',
  'shoes',
  'heels',
  'flats',
  'sandals',
  'boots',
  'loafers',
  'bag',
  'hat',
  // accessories
  'belt',
  'scarf',
  'tie',
  'jewelry',
  'sunglasses',
  'watch',
  'accessory',
] as const;

export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const GARMENT_COLORS = [
  'black',
  'white',
  'gray',
  'navy',
  'blue',
  'light_blue',
  'red',
  'burgundy',
  'pink',
  'purple',
  'green',
  'olive',
  'yellow',
  'orange',
  'brown',
  'camel',
  'beige',
  'cream',
  'gold',
  'silver',
] as const;

export type GarmentColor = (typeof GARMENT_COLORS)[number];

export const GARMENT_PATTERNS = [
  'solid',
  'striped',
  'checked',
  'floral',
  'polka_dot',
  'animal_print',
  'geometric',
  'graphic',
  'other',
] as const;

export type GarmentPattern = (typeof GARMENT_PATTERNS)[number];

export const GARMENT_MATERIALS = [
  'cotton',
  'denim',
  'wool',
  'knit',
  'leather',
  'synthetic',
  'silk',
  'linen',
  'other',
] as const;

export type GarmentMaterial = (typeof GARMENT_MATERIALS)[number];

export const GARMENT_FITS = ['fitted', 'regular', 'loose', 'oversized'] as const;

export type GarmentFit = (typeof GARMENT_FITS)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

export type Season = (typeof SEASONS)[number];

export const GARMENT_FIELDS = [
  'category',
  'colors',
  'pattern',
  'material',
  'formality',
  'seasons',
  'warmth',
  'fit',
  'occasions',
] as const;

export type GarmentField = (typeof GARMENT_FIELDS)[number];

export const SLOTS = [
  'top',
  'bottom',
  'one_piece',
  'outerwear',
  'shoes',
  'bag',
  'headwear',
  'accessory',
] as const;

export type Slot = (typeof SLOTS)[number];

// `occasion` is Plan 2's Postgres enum, reused here rather than redefined.
export const OCCASIONS = ['office', 'university', 'going_out', 'home', 'event', 'sport'] as const;

export type Occasion = (typeof OCCASIONS)[number];

export const CLOTHING_TYPES = ['feminine', 'masculine', 'everything'] as const;

export type ClothingType = (typeof CLOTHING_TYPES)[number];

/** Every category's slot, in `GARMENT_CATEGORIES` order. TS-only — `garments` has no `slot` column. */
export const CATEGORY_SLOT: Record<GarmentCategory, Slot> = {
  t_shirt: 'top',
  blouse: 'top',
  shirt: 'top',
  polo: 'top',
  tank_top: 'top',
  sweater: 'top',
  hoodie: 'top',
  cardigan: 'top',

  pants: 'bottom',
  jeans: 'bottom',
  shorts: 'bottom',
  skirt: 'bottom',
  leggings: 'bottom',

  dress: 'one_piece',
  jumpsuit: 'one_piece',

  jacket: 'outerwear',
  blazer: 'outerwear',
  coat: 'outerwear',
  vest: 'outerwear',

  sneakers: 'shoes',
  shoes: 'shoes',
  heels: 'shoes',
  flats: 'shoes',
  sandals: 'shoes',
  boots: 'shoes',
  loafers: 'shoes',

  bag: 'bag',
  hat: 'headwear',

  belt: 'accessory',
  scarf: 'accessory',
  tie: 'accessory',
  jewelry: 'accessory',
  sunglasses: 'accessory',
  watch: 'accessory',
  accessory: 'accessory',
};

/** The UI palette hex for every garment color (exact values; the app's swatches read them from here). */
export const PALETTE_HEX: Record<GarmentColor, string> = {
  black: '#111111',
  white: '#ffffff',
  gray: '#9ca3af',
  navy: '#1e2a4a',
  blue: '#2563eb',
  light_blue: '#93c5fd',
  red: '#dc2626',
  burgundy: '#7f1d1d',
  pink: '#f9a8d4',
  purple: '#7c3aed',
  green: '#16a34a',
  olive: '#6b7a3a',
  yellow: '#facc15',
  orange: '#f97316',
  brown: '#78350f',
  camel: '#c19a6b',
  beige: '#e8dcc4',
  cream: '#fdf6e3',
  gold: '#d4af37',
  silver: '#c0c0c0',
};

// Feminine-only and masculine-only categories; every other category is available to every
// clothing type, and `everything` sees them all.
const FEMININE_ONLY = new Set<GarmentCategory>(['blouse', 'skirt', 'dress', 'jumpsuit', 'heels', 'flats', 'leggings']);
const MASCULINE_ONLY = new Set<GarmentCategory>(['tie']);

export function slotOf(category: GarmentCategory): Slot {
  return CATEGORY_SLOT[category];
}

/** Categories available to a clothing type, in catalog (`GARMENT_CATEGORIES`) order. */
export function categoriesFor(clothingType: ClothingType): readonly GarmentCategory[] {
  if (clothingType === 'everything') {
    return GARMENT_CATEGORIES;
  }
  if (clothingType === 'feminine') {
    return GARMENT_CATEGORIES.filter((category) => !MASCULINE_ONLY.has(category));
  }
  return GARMENT_CATEGORIES.filter((category) => !FEMININE_ONLY.has(category));
}
