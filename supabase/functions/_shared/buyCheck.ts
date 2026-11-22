// "Should I buy it?": a photographed item against the closet (docs/ai.md#should-i-buy-it). Pure, so the
// verdict comes from these rules and two numbers, never from the model.

import type { GarmentAttributes } from './extraction.ts';
import { pieceGain, wardrobeOf } from './forYou.ts';
import type { RuleGarment } from './outfitRules.ts';

export const MAX_DUPLICATES = 3;
/** With a duplicate, at most this many new outfits is a `skip`. */
export const LOW_NEW_OUTFITS = 5;
/** With no duplicate, at least this many new outfits is a `buy`. */
export const HIGH_NEW_OUTFITS = 10;

export type Verdict = 'buy' | 'think' | 'skip';

export type Comparison = { duplicates: { id: string }[]; newOutfits: number; verdict: Verdict };

/** The item as a garment the user doesn't own yet, so the outfit rules can judge it. */
export function candidateGarment(item: GarmentAttributes): RuleGarment {
  return {
    id: 'candidate',
    category: item.category,
    colors: [...item.colors],
    pattern: item.pattern,
    formality: item.formality,
    seasons: [...item.seasons],
    warmth: item.warmth,
    fit: item.fit,
    status: 'available',
    last_worn_at: null,
    wear_count: 0,
    suggest: true,
    updated_at: '1970-01-01T00:00:00Z',
    pinned_on: null,
  };
}

const known = <T>(a: T | null, b: T | null): boolean => a !== null && b !== null;

/** How far a duplicate sits from the item: smaller is closer, compared field by field. */
function distance(item: GarmentAttributes, garment: RuleGarment): number[] {
  const formalityGap = item.formality !== null && garment.formality !== null ? Math.abs(item.formality - garment.formality) : 5;
  const shared = garment.colors.filter((color) => item.colors.includes(color)).length;
  return [
    garment.colors[0] === item.colors[0] ? 0 : 1,
    known(item.pattern, garment.pattern) && item.pattern === garment.pattern ? 0 : 1,
    formalityGap,
    -shared,
  ];
}

function compareDistance(a: readonly number[], b: readonly number[]): number {
  for (const [index, value] of a.entries()) {
    const difference = value - (b.at(index) ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Garments not donated of the same category whose primary color overlaps the item's (either primary
 * among the other's colors) and whose pattern matches when both are known; closest first, at most 3.
 */
export function findDuplicates(item: GarmentAttributes, garments: readonly RuleGarment[]): string[] {
  const primary = item.colors[0];
  if (item.category === null || primary === undefined) return [];
  return garments
    .filter((g) => {
      if (g.status === 'donated' || g.category !== item.category) return false;
      const own = g.colors[0];
      const overlaps = g.colors.includes(primary) || (own !== undefined && item.colors.includes(own));
      return overlaps && (!known(item.pattern, g.pattern) || item.pattern === g.pattern);
    })
    .map((g) => ({ id: g.id, distance: distance(item, g) }))
    .sort((a, b) => compareDistance(a.distance, b.distance) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_DUPLICATES)
    .map(({ id }) => id);
}

export function buyVerdict(duplicates: number, newOutfits: number): Verdict {
  if (duplicates > 0 && newOutfits <= LOW_NEW_OUTFITS) return 'skip';
  if (duplicates === 0 && newOutfits >= HIGH_NEW_OUTFITS) return 'buy';
  return 'think';
}

/** New outfits count For you's way (the wardrobe, suggestable pieces) with no season: a purchase is for the year. */
export function compareWithCloset(item: GarmentAttributes, garments: readonly RuleGarment[]): Comparison {
  const duplicates = findDuplicates(item, garments).map((id) => ({ id }));
  const suggestable = wardrobeOf(garments).filter((g) => g.suggest);
  const { newOutfits } = pieceGain(candidateGarment(item), suggestable, { season: null });
  return { duplicates, newOutfits, verdict: buyVerdict(duplicates.length, newOutfits) };
}
