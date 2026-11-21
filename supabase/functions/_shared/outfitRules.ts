// Season, outfit-completeness and rule checks, candidate generation and pre-scoring for
// rate-outfit and lucky-list. Pure functions: no network, so no Open-Meteo or Jev calls.

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
export type GarmentStatus = 'available' | 'laundry' | 'lent' | 'donated';

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
  /** Kept by the wears trigger; feeds only `preScore`'s rotation bonus, never a cache key. */
  wear_count: number;
  updated_at: string;
  /** Set by Unused-for-6-months' "Wear it" to tomorrow's local date; null otherwise. */
  pinned_on: string | null;
};

export type Outfit = readonly RuleGarment[];

/**
 * A garment's rating-relevant columns, for the result cache keys: not `updated_at` or
 * `last_worn_at`, which logging a wear bumps, so a wear would otherwise spend the quota again.
 * Changing it changes every stored key.
 */
export function garmentFingerprint(g: RuleGarment): unknown[] {
  return [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth];
}

export type RuleContext = {
  occasion: Occasion | null;
  /** `null`: no season rule (the tropics, or no city), so the weather alone filters. */
  season: Season | null;
  weather: WeatherSummary | null;
  today: string;
  /**
   * Whether the closet has an outerwear piece admissible here (not merely present); default `true`.
   * `generateCandidates` sets it; when `false`, a cold-day outfit may skip outerwear rather than
   * leave the lucky list empty for a user without a coat that fits today's occasion or season.
   */
  outerwearAvailable?: boolean;
};

const NEUTRAL_COLORS = new Set<GarmentColor>(['black', 'white', 'gray', 'navy', 'beige', 'cream', 'camel', 'brown']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PRE_SCORE_DAYS = 30;
/** A never-worn piece's pre-score bonus, worth this many days unworn (docs/ai.md#the-lucky-list-function). */
export const ROTATION_BONUS = 3;
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

/** Within this many degrees of the equator there are no seasons to dress for, only weather. */
export const TROPIC_LATITUDE = 23.44;

/**
 * Month-and-hemisphere season for the user's city latitude (Dec–Feb: winter north, summer south).
 * `null` in the tropics or without a latitude (no city, or not geocodable): the weather decides.
 */
export function seasonOf(date: string, lat: number | null): Season | null {
  if (lat === null || Math.abs(lat) < TROPIC_LATITUDE) return null;
  const month = Number(date.slice(5, 7));
  const north = lat >= 0;

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
  // eslint-disable-next-line security/detect-object-injection -- `northernSeason` is the closed Season union
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
  // eslint-disable-next-line security/detect-object-injection -- `occasion` is the closed Occasion union
  return occasion === null ? FORMALITY_RANGE.any : FORMALITY_RANGE[occasion];
}

/** Season and formality admissibility shared by `passesRules` and `generateCandidates`'s outerwear-availability check, so the two can't drift. */
function isAdmissible(item: RuleGarment, ctx: Pick<RuleContext, 'occasion' | 'season'>): boolean {
  if (item.status !== 'available' || item.category === null) return false;
  if (ctx.season !== null && item.seasons.length > 0 && !item.seasons.includes(ctx.season)) return false;
  const [minFormality, maxFormality] = formalityRangeFor(ctx.occasion);
  if (item.formality !== null && (item.formality < minFormality || item.formality > maxFormality)) return false;
  return true;
}

/**
 * The rules one piece must pass whatever it is worn with: `isAdmissible` (available, in season,
 * in the occasion's formality range) and, when hot, no outerwear and no warmth-3 piece. Shared by
 * `passesRules` and `generateCandidates`'s pools, so the two can't drift.
 */
function fitsAlone(item: RuleGarment, ctx: Pick<RuleContext, 'occasion' | 'season' | 'weather'>): boolean {
  if (item.category === null || !isAdmissible(item, ctx)) return false;
  if (ctx.weather?.band === 'hot' && (slotOf(item.category) === 'outerwear' || item.warmth === 3)) return false;
  return true;
}

/**
 * The rule checks for one candidate outfit, shared by feeling lucky and the swap search: every piece
 * passes `fitsAlone`, a cold day has outerwear (when the closet has any), at most
 * `MAX_NON_NEUTRAL_COLORS` non-neutral colors and at most one non-solid pattern.
 */
export function passesRules(outfit: Outfit, ctx: RuleContext): boolean {
  if (outfit.length === 0) return false;

  const nonNeutralColors = new Set<GarmentColor>();
  let nonSolidPatterns = 0;

  for (const item of outfit) {
    if (!fitsAlone(item, ctx)) return false;

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

/** The optional extras (`bag`, `headwear`, `accessory`): never required, so never part of an outfit's base. */
export function isExtraSlot(slot: Slot): boolean {
  return slot === 'bag' || slot === 'headwear' || slot === 'accessory';
}

/** The outfit without its optional extras: the required pieces plus any outerwear. */
export function basePieces(outfit: Outfit): RuleGarment[] {
  return outfit.filter((item) => item.category === null || !isExtraSlot(slotOf(item.category)));
}

/**
 * Mean over the base pieces of days since last worn (capped at 30), plus 5 for a neutral color, plus
 * `ROTATION_BONUS / (1 + wear_count)` (docs/ai.md#the-lucky-list-function). An extras-only outfit
 * (rate-outfit's freshness of a single swap candidate) scores those pieces instead.
 */
export function preScore(outfit: Outfit, today: string): number {
  const base = basePieces(outfit);
  const pieces = base.length > 0 ? base : outfit;
  if (pieces.length === 0) return 0;
  let score = 0;
  for (const item of pieces) {
    const daysSinceWorn =
      item.last_worn_at === null ? MAX_PRE_SCORE_DAYS : Math.min(MAX_PRE_SCORE_DAYS, daysBetween(item.last_worn_at, today));
    score += daysSinceWorn + ROTATION_BONUS / (1 + item.wear_count);
    if (item.colors.some((color) => NEUTRAL_COLORS.has(color))) score += 5;
  }
  return score / pieces.length;
}

/** True when any piece in the outfit was worn today or in the 6 days before (the same window as `isRecentlyWorn`). */
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

/** A small, fast, deterministic PRNG seeded from a 32-bit integer. */
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
  extras: RuleGarment[];
};

function groupBySlot(garments: readonly RuleGarment[]): SlotGroups {
  const groups: SlotGroups = { top: [], bottom: [], onePiece: [], outerwear: [], shoes: [], extras: [] };
  for (const item of garments) {
    if (item.status !== 'available' || item.category === null) continue;
    const slot = slotOf(item.category);
    if (slot === 'top') groups.top.push(item);
    else if (slot === 'bottom') groups.bottom.push(item);
    else if (slot === 'one_piece') groups.onePiece.push(item);
    else if (slot === 'outerwear') groups.outerwear.push(item);
    else if (slot === 'shoes') groups.shoes.push(item);
    else groups.extras.push(item); // bag, headwear and accessory share one optional extras slot.
  }
  return groups;
}

/** How many draws `generateCandidates` may make in total (both passes) per candidate it is asked for. */
const ATTEMPTS_PER_CANDIDATE = 20;
/** Every 4th draw forces that attempt's pinned garment into its slot. */
const PIN_ATTEMPT_STRIDE = 4;

/** `items` with `pinnedId` moved first when present: `pick` returns index 0 on a forced attempt. */
function withPinnedFirst<T extends { id: string }>(items: readonly T[], pinnedId: string | null): readonly T[] {
  if (pinnedId === null) return items;
  const index = items.findIndex((item) => item.id === pinnedId);
  if (index <= 0) return items;
  const pinned = items.at(index);
  if (pinned === undefined) return items;
  return [pinned, ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Rule-passing outfits from seeded random draws (deterministic for a seed and closet order); the
 * sampling, the 7-day fallback pass and the pin bias: docs/ai.md#the-lucky-list-function. Pins are
 * only biased toward; lucky-list re-checks that a returned candidate contains one.
 */
export function generateCandidates(
  garments: readonly RuleGarment[],
  ctx: RuleContext,
  seed: string,
  limit = DEFAULT_CANDIDATE_LIMIT,
  pinnedIds: readonly string[] = [],
): Outfit[] {
  const rng = mulberry32(hashString(seed));
  const groups = groupBySlot(garments);

  // Admissible, not merely owned: an inadmissible-only coat behaves the same as owning none.
  const admissibleOuterwear = groups.outerwear.filter((item) => isAdmissible(item, ctx));
  const outerwearAvailable = admissibleOuterwear.length > 0;
  const ctxWithOuterwear: RuleContext = { ...ctx, outerwearAvailable };
  const needsOuterwear =
    outerwearAvailable &&
    ctx.weather !== null &&
    (ctx.weather.band === 'cold' || (ctx.weather.rain && ctx.weather.band !== 'hot'));

  // Only admissible pins claim forced attempts; an inadmissible one would starve its siblings.
  const byId = new Map(garments.map((item) => [item.id, item]));
  const admissiblePins = pinnedIds.flatMap((id) => {
    const item = byId.get(id);
    return item !== undefined && fitsAlone(item, ctx) ? [item] : [];
  });
  const admissiblePinIds = new Set(admissiblePins.map((item) => item.id));
  const outerwearPinIds = new Set(
    admissiblePins.filter((item) => item.category !== null && slotOf(item.category) === 'outerwear').map((item) => item.id),
  );

  const pick = <T extends { id: string }>(items: readonly T[], pinnedId: string | null): T | undefined => {
    if (pinnedId !== null && items[0]?.id === pinnedId) return items[0];
    return items.at(Math.floor(rng() * items.length));
  };
  let drawsLeft = limit * ATTEMPTS_PER_CANDIDATE;
  let attemptCount = 0;

  function draw(excludeRecentlyWorn: boolean, remaining: number, maxDraws: number): Outfit[] {
    // An admissible pin survives the recent-wear exclusion (a wear after the "Wear it" tap).
    const pool = (items: readonly RuleGarment[]): readonly RuleGarment[] =>
      items.filter(
        (item) =>
          fitsAlone(item, ctx) &&
          (admissiblePinIds.has(item.id) || !(excludeRecentlyWorn && isRecentlyWorn(item, ctx.today))),
      );
    const shoes = pool(groups.shoes);
    const tops = pool(groups.top);
    const bottoms = pool(groups.bottom);
    const onePieces = pool(groups.onePiece);
    const outerwear = pool(admissibleOuterwear);
    const extras = pool(groups.extras);
    const pairWeight = tops.length > 0 && bottoms.length > 0 ? (tops.length + bottoms.length) / 2 : 0;
    const totalWeight = pairWeight + onePieces.length;
    if (remaining <= 0 || shoes.length === 0 || totalWeight === 0 || (needsOuterwear && outerwear.length === 0)) return [];

    const results: Outfit[] = [];
    const seen = new Set<string>();
    for (let attempt = 0; attempt < maxDraws && results.length < remaining; attempt += 1) {
      drawsLeft -= 1;
      // Round-robin over the admissible pins so each gets a fair share of the bias.
      const forcedPin =
        admissiblePins.length > 0 && attemptCount % PIN_ATTEMPT_STRIDE === 0
          ? (admissiblePins.at(Math.floor(attemptCount / PIN_ATTEMPT_STRIDE) % admissiblePins.length) ?? null)
          : null;
      attemptCount += 1;
      const pinnedId = forcedPin?.id ?? null;

      // `passesRules` allows outerwear any day (it only requires it when cold).
      const drawOuterwear = needsOuterwear || (pinnedId !== null && outerwearPinIds.has(pinnedId));

      const outfit: (RuleGarment | undefined)[] = [pick(withPinnedFirst(shoes, pinnedId), pinnedId)];
      if (rng() * totalWeight < pairWeight) {
        outfit.push(pick(withPinnedFirst(tops, pinnedId), pinnedId), pick(withPinnedFirst(bottoms, pinnedId), pinnedId));
      } else {
        outfit.push(pick(withPinnedFirst(onePieces, pinnedId), pinnedId));
      }
      if (drawOuterwear) outfit.push(pick(withPinnedFirst(outerwear, pinnedId), pinnedId));
      // "none" weighs as much as every extra together.
      if (extras.length > 0 && rng() < 0.5) outfit.push(pick(withPinnedFirst(extras, pinnedId), pinnedId));

      const pieces = outfit.filter((item) => item !== undefined);
      const key = pieces
        .map((item) => item.id)
        .sort()
        .join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (passesRules(pieces, ctxWithOuterwear)) results.push(pieces);
    }
    return results;
  }

  const withoutRecent = draw(true, limit, Math.floor(drawsLeft / 2));
  if (withoutRecent.length >= MIN_FALLBACK_CANDIDATES) return withoutRecent;
  return draw(false, limit, drawsLeft);
}
