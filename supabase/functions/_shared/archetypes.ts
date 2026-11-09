// The For you archetypes: generic wardrobe staples (a camel blazer, white sneakers, dark straight
// jeans, ...) that the for-you function weighs against the user's closet. Each one carries the
// same attributes as a garment row, so the outfit rules can judge it like any other piece.
//
// Runtime-neutral (only `catalog.ts` imported). Ids are stable: they key the cached ideas and the
// Claude lines, so rename one only together with a cache flush.
//
// NOTE: only outfit pieces (tops, bottoms, one-pieces, outerwear, shoes) are listed. Extras (bags,
// belts, scarves) never make an outfit complete, so they would add no outfit a closet can't
// already make; the upgrade path is a separate "finish the look" list for them.

import type { ClothingType, GarmentCategory, GarmentColor, GarmentFit, GarmentPattern, Season } from './catalog.ts';

export type Archetype = {
  id: string;
  category: GarmentCategory;
  colors: GarmentColor[];
  pattern: GarmentPattern;
  /** 1 = very casual (sport, lounge), 3 = smart casual, 5 = formal; the extraction scale. */
  formality: number;
  seasons: Season[];
  /** 1 = light (summer), 2 = medium, 3 = warm (winter). */
  warmth: number;
  fit: GarmentFit;
  clothing: 'feminine' | 'masculine' | 'all';
};

const ALL_YEAR: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const WARM_HALF: Season[] = ['spring', 'summer'];
const MILD: Season[] = ['spring', 'autumn'];
const COLD_HALF: Season[] = ['autumn', 'winter'];
const NOT_SUMMER: Season[] = ['spring', 'autumn', 'winter'];
const NOT_WINTER: Season[] = ['spring', 'summer', 'autumn'];

type Clothing = Archetype['clothing'];

function staple(
  clothing: Clothing,
  id: string,
  category: GarmentCategory,
  colors: GarmentColor[],
  formality: number,
  seasons: Season[],
  warmth: number,
  fit: GarmentFit,
  pattern: GarmentPattern = 'solid',
): Archetype {
  return { id, category, colors, pattern, formality, seasons, warmth, fit, clothing };
}

export const ARCHETYPES: readonly Archetype[] = [
  // Shared staples.
  staple('all', 'white-tee', 't_shirt', ['white'], 2, ALL_YEAR, 1, 'regular'),
  staple('all', 'black-tee', 't_shirt', ['black'], 2, ALL_YEAR, 1, 'regular'),
  staple('all', 'breton-tee', 't_shirt', ['navy', 'white'], 2, NOT_WINTER, 1, 'regular', 'striped'),
  staple('all', 'white-shirt', 'shirt', ['white'], 3, ALL_YEAR, 1, 'regular'),
  staple('all', 'light-blue-shirt', 'shirt', ['light_blue'], 3, ALL_YEAR, 1, 'regular'),
  staple('all', 'navy-sweater', 'sweater', ['navy'], 3, COLD_HALF, 3, 'regular'),
  staple('all', 'gray-sweater', 'sweater', ['gray'], 2, COLD_HALF, 3, 'regular'),
  staple('all', 'gray-hoodie', 'hoodie', ['gray'], 1, NOT_SUMMER, 2, 'loose'),
  staple('all', 'dark-jeans', 'jeans', ['navy'], 2, ALL_YEAR, 2, 'regular'),
  staple('all', 'black-jeans', 'jeans', ['black'], 2, ALL_YEAR, 2, 'fitted'),
  staple('all', 'light-jeans', 'jeans', ['light_blue'], 2, WARM_HALF, 2, 'regular'),
  staple('all', 'beige-chinos', 'pants', ['beige'], 3, NOT_WINTER, 2, 'regular'),
  staple('all', 'black-trousers', 'pants', ['black'], 4, ALL_YEAR, 2, 'regular'),
  staple('all', 'camel-blazer', 'blazer', ['camel'], 4, NOT_SUMMER, 2, 'regular'),
  staple('all', 'navy-blazer', 'blazer', ['navy'], 4, ALL_YEAR, 2, 'regular'),
  staple('all', 'denim-jacket', 'jacket', ['blue'], 2, MILD, 2, 'regular'),
  staple('all', 'black-leather-jacket', 'jacket', ['black'], 3, MILD, 2, 'fitted'),
  staple('all', 'camel-coat', 'coat', ['camel'], 4, COLD_HALF, 3, 'regular'),
  staple('all', 'beige-trench', 'coat', ['beige'], 3, MILD, 2, 'regular'),
  staple('all', 'black-puffer', 'coat', ['black'], 1, ['winter'], 3, 'loose'),
  staple('all', 'white-sneakers', 'sneakers', ['white'], 2, ALL_YEAR, 1, 'regular'),
  staple('all', 'black-boots', 'boots', ['black'], 3, COLD_HALF, 3, 'regular'),
  staple('all', 'camel-boots', 'boots', ['camel'], 3, NOT_SUMMER, 2, 'regular'),
  staple('all', 'brown-loafers', 'loafers', ['brown'], 4, ALL_YEAR, 1, 'regular'),
  staple('all', 'camel-sandals', 'sandals', ['camel'], 1, ['summer'], 1, 'regular'),

  // Feminine staples.
  staple('feminine', 'white-blouse', 'blouse', ['white'], 3, ALL_YEAR, 1, 'regular'),
  staple('feminine', 'cream-silk-blouse', 'blouse', ['cream'], 4, ALL_YEAR, 1, 'loose'),
  staple('feminine', 'white-tank', 'tank_top', ['white'], 1, WARM_HALF, 1, 'fitted'),
  staple('feminine', 'cream-cardigan', 'cardigan', ['cream'], 2, NOT_SUMMER, 2, 'regular'),
  staple('feminine', 'cream-wide-pants', 'pants', ['cream'], 3, NOT_WINTER, 2, 'loose'),
  staple('feminine', 'black-midi-skirt', 'skirt', ['black'], 3, ALL_YEAR, 1, 'regular'),
  staple('feminine', 'denim-skirt', 'skirt', ['blue'], 2, WARM_HALF, 1, 'regular'),
  staple('feminine', 'beige-pleated-skirt', 'skirt', ['beige'], 3, NOT_SUMMER, 2, 'regular'),
  staple('feminine', 'black-leggings', 'leggings', ['black'], 1, NOT_SUMMER, 2, 'fitted'),
  staple('feminine', 'little-black-dress', 'dress', ['black'], 4, ALL_YEAR, 1, 'fitted'),
  staple('feminine', 'floral-dress', 'dress', ['pink', 'green'], 2, WARM_HALF, 1, 'regular', 'floral'),
  staple('feminine', 'navy-wrap-dress', 'dress', ['navy'], 3, NOT_WINTER, 1, 'fitted'),
  staple('feminine', 'black-jumpsuit', 'jumpsuit', ['black'], 4, NOT_WINTER, 1, 'regular'),
  staple('feminine', 'black-heels', 'heels', ['black'], 5, ALL_YEAR, 1, 'regular'),
  staple('feminine', 'beige-heels', 'heels', ['beige'], 4, NOT_WINTER, 1, 'regular'),
  staple('feminine', 'black-flats', 'flats', ['black'], 3, NOT_WINTER, 1, 'regular'),

  // Masculine staples.
  staple('masculine', 'navy-polo', 'polo', ['navy'], 2, WARM_HALF, 1, 'regular'),
  staple('masculine', 'white-polo', 'polo', ['white'], 2, WARM_HALF, 1, 'regular'),
  staple('masculine', 'denim-shirt', 'shirt', ['blue'], 2, NOT_SUMMER, 2, 'regular'),
  staple('masculine', 'flannel-shirt', 'shirt', ['red', 'navy'], 1, COLD_HALF, 2, 'regular', 'checked'),
  staple('masculine', 'olive-overshirt', 'shirt', ['olive'], 2, MILD, 2, 'loose'),
  staple('masculine', 'cream-knit', 'sweater', ['cream'], 2, COLD_HALF, 3, 'regular'),
  staple('masculine', 'gray-trousers', 'pants', ['gray'], 4, ALL_YEAR, 2, 'regular'),
  staple('masculine', 'olive-chinos', 'pants', ['olive'], 2, NOT_WINTER, 2, 'regular'),
  staple('masculine', 'navy-chinos', 'pants', ['navy'], 3, ALL_YEAR, 2, 'regular'),
  staple('masculine', 'beige-shorts', 'shorts', ['beige'], 2, ['summer'], 1, 'regular'),
  staple('masculine', 'navy-shorts', 'shorts', ['navy'], 1, ['summer'], 1, 'regular'),
  staple('masculine', 'gray-blazer', 'blazer', ['gray'], 4, NOT_SUMMER, 2, 'regular'),
  staple('masculine', 'navy-bomber', 'jacket', ['navy'], 2, MILD, 2, 'regular'),
  staple('masculine', 'navy-vest', 'vest', ['navy'], 2, COLD_HALF, 2, 'regular'),
  staple('masculine', 'black-oxfords', 'shoes', ['black'], 5, ALL_YEAR, 1, 'regular'),
  staple('masculine', 'brown-derbies', 'shoes', ['brown'], 4, ALL_YEAR, 1, 'regular'),
  staple('masculine', 'gray-runners', 'sneakers', ['gray'], 1, ALL_YEAR, 1, 'regular'),
];

/** The archetypes for a clothing type: its own plus the shared ones; `everything` gets the whole list. */
export function archetypesFor(clothingType: ClothingType): readonly Archetype[] {
  if (clothingType === 'everything') return ARCHETYPES;
  return ARCHETYPES.filter((archetype) => archetype.clothing === 'all' || archetype.clothing === clothingType);
}
