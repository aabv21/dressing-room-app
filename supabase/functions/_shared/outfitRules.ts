// Season derivation, outfit-completeness and rule checks, candidate generation and pre-scoring
// for the rate-outfit and lucky-list Edge Functions.
//
// Runtime-neutral (only `catalog.ts` and `weather.ts` imported, nothing Deno- or Node-only) so
// Jest exercises it under Node and the Edge Functions run it under Deno. Never calls the real
// Open-Meteo or Jev services; see `global-constraints.md`.

import {
  type GarmentCategory,
  type GarmentColor,
  type GarmentFit,
  type GarmentPattern,
  type Occasion,
  type Season,
  type Slot,
  slotOf,
} from './catalog.ts';
import type { WeatherSummary } from './weather.ts';

/** `public.garment_status`, not yet exported from `catalog.ts` (that enum lives only in SQL today). */
export type GarmentStatus = 'available' | 'laundry' | 'lent';

/** The rating-relevant columns of a `garments` row that the outfit rules read. */
export type RuleGarment = {
  id: string;
  category: GarmentCategory | null;
  colors: GarmentColor[];
  pattern: GarmentPattern | null;
  formality: number | null;
  seasons: Season[];
  warmth: number | null;
  fit: GarmentFit | null;
  status: GarmentStatus;
  last_worn_at: string | null;
  updated_at: string;
};

export type Outfit = readonly RuleGarment[];

export type RuleContext = {
  occasion: Occasion | null;
  season: Season;
  weather: WeatherSummary | null;
  today: string;
  /**
   * Whether the closet has at least one outerwear piece admissible for this context (available,
   * in-season, in the occasion's formality range — not merely present in the closet). Defaults
   * to `true` so existing callers (and `passesRules`'s pre-P4-R7 semantics) are unaffected;
   * `generateCandidates` sets it from the actual closet. When `false`, a cold-weather outfit is
   * allowed with no outerwear rather than making the lucky list empty for a user who owns none,
   * or whose only coat doesn't fit today's occasion or season (ruling P4-R7).
   */
  outerwearAvailable?: boolean;
};

const NEUTRAL_COLORS = new Set<GarmentColor>(['black', 'white', 'gray', 'navy', 'beige', 'cream', 'camel', 'brown']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PRE_SCORE_DAYS = 30;
const RECENT_WEAR_DAYS = 7;
const MAX_NON_NEUTRAL_COLORS = 3;
const MIN_FALLBACK_CANDIDATES = 3;
const DEFAULT_CANDIDATE_LIMIT = 200;

/** Occasion formality ranges (garment formality 1–5); `any` covers no-occasion requests. */
export const FORMALITY_RANGE: Record<Occasion | 'any', readonly [number, number]> = {
  office: [3, 5],
  university: [1, 4],
  going_out: [2, 5],
  home: [1, 3],
  event: [4, 5],
  sport: [1, 2],
  any: [1, 5],
};

/** Days between two `YYYY-MM-DD` dates, truncated toward zero. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.trunc((to - from) / MS_PER_DAY);
}

/** True when `item` was worn within the last `RECENT_WEAR_DAYS` days (inclusive of today, exclusive of day 7). */
function isRecentlyWorn(item: RuleGarment, today: string): boolean {
  if (item.last_worn_at === null) return false;
  const days = daysBetween(item.last_worn_at, today);
  return days >= 0 && days < RECENT_WEAR_DAYS;
}

/**
 * Month-and-hemisphere season, per `global-constraints.md`'s "Weather" rules. `lat` is the
 * user's current city latitude; `null` (no city, or a city that can't be geocoded) defaults to
 * the northern hemisphere.
 */
export function seasonOf(date: string, lat: number | null): Season {
  const month = Number(date.slice(5, 7));
  const north = lat === null || lat >= 0;

  // Northern-hemisphere month -> season; the south is offset by two quarters.
  const northernSeason: Season =
    month === 12 || month <= 2
      ? 'winter'
      : month <= 5
        ? 'spring'
        : month <= 8
          ? 'summer'
          : 'autumn';

  if (north) return northernSeason;

  const opposite: Record<Season, Season> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
  return opposite[northernSeason];
}

/** True when the slots given satisfy (top + bottom) or one_piece, plus shoes. */
export function isCompleteOutfit(slots: readonly Slot[]): boolean {
  const present = new Set(slots);
  const topAndBottom = present.has('top') && present.has('bottom');
  const onePiece = present.has('one_piece');
  return (topAndBottom || onePiece) && present.has('shoes');
}

/** The required slots (`top`/`bottom`/`shoes`, a `one_piece` satisfying top+bottom) with no usable garment. */
export function missingSlots(garments: readonly RuleGarment[]): Slot[] {
  const usableSlots = new Set<Slot>();
  for (const item of garments) {
    if (item.status !== 'available' || item.category === null) continue;
    usableSlots.add(slotOf(item.category));
  }

  const missing: Slot[] = [];
  if (!usableSlots.has('top') && !usableSlots.has('bottom') && !usableSlots.has('one_piece')) {
    missing.push('top', 'bottom');
  } else {
    if (!usableSlots.has('top') && !usableSlots.has('one_piece')) missing.push('top');
    if (!usableSlots.has('bottom') && !usableSlots.has('one_piece')) missing.push('bottom');
  }
  if (!usableSlots.has('shoes')) missing.push('shoes');
  return missing;
}

function formalityRangeFor(occasion: Occasion | null): readonly [number, number] {
  return occasion === null ? FORMALITY_RANGE.any : FORMALITY_RANGE[occasion];
}

/** Season and formality admissibility shared by `passesRules` and `generateCandidates`'s outerwear-availability check, so the two can't drift. */
function isAdmissible(item: RuleGarment, ctx: Pick<RuleContext, 'occasion' | 'season'>): boolean {
  if (item.status !== 'available' || item.category === null) return false;
  if (item.seasons.length > 0 && !item.seasons.includes(ctx.season)) return false;
  const [minFormality, maxFormality] = formalityRangeFor(ctx.occasion);
  if (item.formality !== null && (item.formality < minFormality || item.formality > maxFormality)) return false;
  return true;
}

/** All of global-constraints.md's "Feeling lucky"/rating rule checks for one candidate outfit. */
export function passesRules(outfit: Outfit, ctx: RuleContext): boolean {
  if (outfit.length === 0) return false;

  const nonNeutralColors = new Set<GarmentColor>();
  let nonSolidPatterns = 0;

  for (const item of outfit) {
    if (item.category === null || !isAdmissible(item, ctx)) return false;

    const slot = slotOf(item.category);
    if (ctx.weather?.band === 'hot') {
      if (slot === 'outerwear') return false;
      if (item.warmth === 3) return false;
    }

    for (const color of item.colors) {
      if (!NEUTRAL_COLORS.has(color)) nonNeutralColors.add(color);
    }
    if (item.pattern !== null && item.pattern !== 'solid') nonSolidPatterns += 1;
  }

  if (ctx.weather?.band === 'cold' && (ctx.outerwearAvailable ?? true)) {
    const hasOuterwear = outfit.some((item) => item.category !== null && slotOf(item.category) === 'outerwear');
    if (!hasOuterwear) return false;
  }

  if (nonNeutralColors.size > MAX_NON_NEUTRAL_COLORS) return false;
  if (nonSolidPatterns > 1) return false;

  return true;
}

/** Sum of (days since last worn, never-worn = 30, capped at 30) plus 5 per neutral-color piece. */
export function preScore(outfit: Outfit, today: string): number {
  let score = 0;
  for (const item of outfit) {
    const daysSinceWorn =
      item.last_worn_at === null ? MAX_PRE_SCORE_DAYS : Math.min(MAX_PRE_SCORE_DAYS, daysBetween(item.last_worn_at, today));
    score += daysSinceWorn;
    if (item.colors.some((color) => NEUTRAL_COLORS.has(color))) score += 5;
  }
  return score;
}

/** True when any piece in the outfit was worn within the last 7 days (inclusive). */
export function wornThisWeek(outfit: Outfit, today: string): boolean {
  return outfit.some((item) => isRecentlyWorn(item, today));
}

// --- Deterministic seeded shuffle (mulberry32 over a string hash) ---------------------------

function hashString(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, deterministic PRNG seeded from a 32-bit integer. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy of `items`, driven by `rng` (deterministic for a seeded rng). */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const atI = shuffled.at(i);
    const atJ = shuffled.at(j);
    if (atI === undefined || atJ === undefined) continue;
    // eslint-disable-next-line security/detect-object-injection -- numeric Fisher-Yates swap indices, not user input.
    shuffled[i] = atJ;
    // eslint-disable-next-line security/detect-object-injection -- numeric Fisher-Yates swap indices, not user input.
    shuffled[j] = atI;
  }
  return shuffled;
}

type SlotGroups = {
  top: RuleGarment[];
  bottom: RuleGarment[];
  onePiece: RuleGarment[];
  outerwear: RuleGarment[];
  shoes: RuleGarment[];
  bag: RuleGarment[];
  accessory: RuleGarment[];
};

function groupBySlot(garments: readonly RuleGarment[]): SlotGroups {
  const groups: SlotGroups = { top: [], bottom: [], onePiece: [], outerwear: [], shoes: [], bag: [], accessory: [] };
  for (const item of garments) {
    if (item.status !== 'available' || item.category === null) continue;
    const slot = slotOf(item.category);
    if (slot === 'top') groups.top.push(item);
    else if (slot === 'bottom') groups.bottom.push(item);
    else if (slot === 'one_piece') groups.onePiece.push(item);
    else if (slot === 'outerwear') groups.outerwear.push(item);
    else if (slot === 'shoes') groups.shoes.push(item);
    else if (slot === 'bag') groups.bag.push(item);
    else groups.accessory.push(item); // 'accessory' and 'headwear' share one optional extras slot.
  }
  return groups;
}

/** Yields every top+bottom/shoes and one_piece/shoes base combination, shuffled-list order, lazily. */
function* baseCombinations(groups: SlotGroups): Generator<RuleGarment[]> {
  for (const shoes of groups.shoes) {
    for (const top of groups.top) {
      for (const bottom of groups.bottom) {
        yield [top, bottom, shoes];
      }
    }
    for (const onePiece of groups.onePiece) {
      yield [onePiece, shoes];
    }
  }
}

/**
 * Builds rule-passing outfit candidates from the garments given, lazily from a seeded-shuffled
 * per-slot list so a large closet never materializes every combination before stopping at
 * `limit`. Adds outerwear when the weather calls for it, then at most one bag/accessory.
 */
export function generateCandidates(
  garments: readonly RuleGarment[],
  ctx: RuleContext,
  seed: string,
  limit = DEFAULT_CANDIDATE_LIMIT,
): Outfit[] {
  const rng = mulberry32(hashString(seed));
  const groups = groupBySlot(garments);
  const shuffled: SlotGroups = {
    top: seededShuffle(groups.top, rng),
    bottom: seededShuffle(groups.bottom, rng),
    onePiece: seededShuffle(groups.onePiece, rng),
    outerwear: seededShuffle(groups.outerwear, rng),
    shoes: seededShuffle(groups.shoes, rng),
    bag: seededShuffle(groups.bag, rng),
    accessory: seededShuffle(groups.accessory, rng),
  };

  // Hoisted out of the per-combination loop (P4-R7): computed once from the closet, not
  // re-derived for every base combination. "Available" means admissible for this context, not
  // merely in the closet — an inadmissible-only coat (wrong formality/season) must behave the
  // same as owning none, using the same `isAdmissible` check `passesRules` applies per piece
  // (fix round 2: the formality/season gap in the first P4-R7 fix).
  const admissibleOuterwear = shuffled.outerwear.filter((item) => isAdmissible(item, ctx));
  const outerwearAvailable = admissibleOuterwear.length > 0;
  const ctxWithOuterwear: RuleContext = { ...ctx, outerwearAvailable };
  const needsOuterwear =
    outerwearAvailable &&
    ctx.weather !== null &&
    (ctx.weather.band === 'cold' || (ctx.weather.rain && ctx.weather.band !== 'hot'));
  const extras: Array<RuleGarment | null> = [null, ...shuffled.bag, ...shuffled.accessory];

  function buildOutfits(excludeRecentlyWorn: boolean, remaining: number): Outfit[] {
    if (remaining <= 0) return [];
    const results: Outfit[] = [];

    outer: for (const base of baseCombinations(shuffled)) {
      if (excludeRecentlyWorn && base.some((item) => isRecentlyWorn(item, ctx.today))) continue;

      const outerwearOptions: Array<RuleGarment | null> = needsOuterwear ? admissibleOuterwear : [null];

      for (const outerwear of outerwearOptions) {
        if (excludeRecentlyWorn && outerwear !== null && isRecentlyWorn(outerwear, ctx.today)) continue;

        for (const extra of extras) {
          if (excludeRecentlyWorn && extra !== null && isRecentlyWorn(extra, ctx.today)) continue;

          const outfit: RuleGarment[] = [...base];
          if (outerwear !== null) outfit.push(outerwear);
          if (extra !== null) outfit.push(extra);

          if (passesRules(outfit, ctxWithOuterwear)) {
            results.push(outfit);
            if (results.length >= remaining) break outer;
          }
        }
      }
    }

    return results;
  }

  const withoutRecent = buildOutfits(true, limit);
  if (withoutRecent.length >= MIN_FALLBACK_CANDIDATES) return withoutRecent;
  return buildOutfits(false, limit);
}
