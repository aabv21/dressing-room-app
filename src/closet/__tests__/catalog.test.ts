import { AGE_GROUPS, BODY_TYPES, STYLES } from '../../../supabase/functions/_shared/rating.ts';
import { Constants } from '../../lib/database.types';
import { en } from '../../i18n/en';
import { es } from '../../i18n/es';
import {
  CATEGORY_SLOT,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  GARMENT_FIELDS,
  GARMENT_FITS,
  GARMENT_MATERIALS,
  GARMENT_PATTERNS,
  OCCASIONS,
  PALETTE_HEX,
  SEASONS,
  SLOTS,
  categoriesFor,
  slotOf,
  type ClothingType,
  type GarmentCategory,
  type Slot,
} from '../catalog';

// Compares two readonly tuples as sets: same members, any order.
function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().join() === [...expected].sort().join();
}

describe('catalog tuples match the generated database enums', () => {
  test.each([
    ['GARMENT_CATEGORIES', GARMENT_CATEGORIES, Constants.public.Enums.garment_category],
    ['GARMENT_COLORS', GARMENT_COLORS, Constants.public.Enums.garment_color],
    ['GARMENT_PATTERNS', GARMENT_PATTERNS, Constants.public.Enums.garment_pattern],
    ['GARMENT_MATERIALS', GARMENT_MATERIALS, Constants.public.Enums.garment_material],
    ['GARMENT_FITS', GARMENT_FITS, Constants.public.Enums.garment_fit],
    ['SEASONS', SEASONS, Constants.public.Enums.season],
    ['GARMENT_FIELDS', GARMENT_FIELDS, Constants.public.Enums.garment_field],
    ['OCCASIONS', OCCASIONS, Constants.public.Enums.occasion],
    ['BODY_TYPES', BODY_TYPES, Constants.public.Enums.body_type],
    ['AGE_GROUPS', AGE_GROUPS, Constants.public.Enums.age_group],
    ['STYLES', STYLES, Constants.public.Enums.style],
  ] as const)('%s has the same members as the generated enum', (_name, tuple, generated) => {
    expect(sameMembers(tuple, generated)).toBe(true);
  });
});

describe('slotOf', () => {
  test('covers every category', () => {
    for (const category of GARMENT_CATEGORIES) {
      expect(SLOTS).toContain(slotOf(category));
    }
  });

  test.each([
    ['t_shirt', 'top'],
    ['blouse', 'top'],
    ['shirt', 'top'],
    ['polo', 'top'],
    ['tank_top', 'top'],
    ['sweater', 'top'],
    ['hoodie', 'top'],
    ['cardigan', 'top'],
    ['pants', 'bottom'],
    ['jeans', 'bottom'],
    ['shorts', 'bottom'],
    ['skirt', 'bottom'],
    ['leggings', 'bottom'],
    ['dress', 'one_piece'],
    ['jumpsuit', 'one_piece'],
    ['jacket', 'outerwear'],
    ['blazer', 'outerwear'],
    ['coat', 'outerwear'],
    ['vest', 'outerwear'],
    ['sneakers', 'shoes'],
    ['shoes', 'shoes'],
    ['heels', 'shoes'],
    ['flats', 'shoes'],
    ['sandals', 'shoes'],
    ['boots', 'shoes'],
    ['loafers', 'shoes'],
    ['bag', 'bag'],
    ['hat', 'headwear'],
    ['belt', 'accessory'],
    ['scarf', 'accessory'],
    ['tie', 'accessory'],
    ['jewelry', 'accessory'],
    ['sunglasses', 'accessory'],
    ['watch', 'accessory'],
    ['accessory', 'accessory'],
  ] satisfies ReadonlyArray<readonly [GarmentCategory, Slot]>)('slotOf(%s) → %s', (category, slot) => {
    expect(slotOf(category)).toBe(slot);
  });

  test('CATEGORY_SLOT agrees with slotOf for every category', () => {
    for (const category of GARMENT_CATEGORIES) {
      expect(CATEGORY_SLOT[category]).toBe(slotOf(category));
    }
  });
});

describe('categoriesFor', () => {
  test('masculine excludes feminine-only categories and includes tie', () => {
    const categories = categoriesFor('masculine');
    expect(categories).toContain('tie');
    for (const feminineOnly of ['blouse', 'skirt', 'dress', 'jumpsuit', 'heels', 'flats', 'leggings'] as const) {
      expect(categories).not.toContain(feminineOnly);
    }
  });

  test('feminine includes feminine-only categories and excludes tie', () => {
    const categories = categoriesFor('feminine');
    expect(categories).not.toContain('tie');
    for (const feminineOnly of ['blouse', 'skirt', 'dress', 'jumpsuit', 'heels', 'flats', 'leggings'] as const) {
      expect(categories).toContain(feminineOnly);
    }
  });

  test('everything has every category', () => {
    expect(sameMembers(categoriesFor('everything'), GARMENT_CATEGORIES)).toBe(true);
  });

  test.each(['feminine', 'masculine', 'everything'] satisfies readonly ClothingType[])(
    '%s follows catalog order',
    (clothingType) => {
      const categories = categoriesFor(clothingType);
      const indices = categories.map((category) => GARMENT_CATEGORIES.indexOf(category));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    },
  );
});

describe('i18n labels', () => {
  function expectLabeled(prefix: string, values: readonly string[]): void {
    for (const value of values) {
      const key = `${prefix}.${value}`;
      expect(en[key as keyof typeof en]).toBeTruthy();
      expect(es[key as keyof typeof es]).toBeTruthy();
    }
  }

  test('every garment.category value has non-empty en and es labels', () => {
    expectLabeled('garment.category', GARMENT_CATEGORIES);
  });

  test('every garment.color value has non-empty en and es labels', () => {
    expectLabeled('garment.color', GARMENT_COLORS);
  });

  test('every garment.pattern value has non-empty en and es labels', () => {
    expectLabeled('garment.pattern', GARMENT_PATTERNS);
  });

  test('every garment.material value has non-empty en and es labels', () => {
    expectLabeled('garment.material', GARMENT_MATERIALS);
  });

  test('every garment.fit value has non-empty en and es labels', () => {
    expectLabeled('garment.fit', GARMENT_FITS);
  });

  test('every garment.season value has non-empty en and es labels', () => {
    expectLabeled('garment.season', SEASONS);
  });

  test('every garment.slot value has non-empty en and es labels', () => {
    expectLabeled('garment.slot', SLOTS);
  });

  test('every garment.status value has non-empty en and es labels', () => {
    expectLabeled('garment.status', Constants.public.Enums.garment_status);
  });
});

describe('PALETTE_HEX', () => {
  test('has a 6-digit lowercase hex value for every color', () => {
    for (const color of GARMENT_COLORS) {
      expect(PALETTE_HEX[color]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
