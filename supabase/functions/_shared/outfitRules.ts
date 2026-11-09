// Season derivation, outfit-completeness and rule checks, candidate generation and pre-scoring
// for the rate-outfit and lucky-list Edge Functions.
//
// Runtime-neutral (only `catalog.ts` and `weather.ts` imported, nothing Deno- or Node-only) so
// Jest exercises it under Node and the Edge Functions run it under Deno. Pure functions over the
// data they're given: no network, so no Open-Meteo or Jev calls.

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
  /** Set by Unused-for-6-months' "Wear it" to tomorrow's local date; null otherwise. */
  pinned_on: string | null;
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
 * Month-and-hemisphere season: Dec–Feb is winter in the north and summer in the south, Mar–May
 * spring in the north and autumn in the south, and so on. `lat` is the user's current city
 * latitude; its sign picks the hemisphere, and `null` (no city, or a city that can't be geocoded)
 * defaults to the northern one.
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
 * The mean, over the outfit's base pieces, of (days since last worn, never-worn = 30, capped at
 * 30) plus 5 for a piece with a neutral color. Extras don't count (ruling P4-R13), so adding a
 * belt can't win, and a mean doesn't favor top + bottom over a one-piece for having one more
 * piece. An outfit of extras only (rate-outfit's freshness of a single swap candidate) scores
 * those pieces instead.
 */
export function preScore(outfit: Outfit, today: string): number {
  const base = basePieces(outfit);
  const pieces = base.length > 0 ? base : outfit;
  if (pieces.length === 0) return 0;
  let score = 0;
  for (const item of pieces) {
    const daysSinceWorn =
      item.last_worn_at === null ? MAX_PRE_SCORE_DAYS : Math.min(MAX_PRE_SCORE_DAYS, daysBetween(item.last_worn_at, today));
    score += daysSinceWorn;
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
/** Every 4th draw forces that attempt's pinned garment into its slot (so 1 in 4, or 5, of a candidate's 20 attempts; see `generateCandidates`). */
const PIN_ATTEMPT_STRIDE = 4;

/**
 * `items`, with `pinnedId` moved first when it's a member: `pick`'s index-0 fallback (an empty
 * `rng()` draw never lands past the array) and the forced-pick stride in `generateCandidates`
 * both read index 0, so this is the one place a "pick the pinned garment" attempt needs.
 */
function withPinnedFirst<T extends { id: string }>(items: readonly T[], pinnedId: string | null): readonly T[] {
  if (pinnedId === null) return items;
  const index = items.findIndex((item) => item.id === pinnedId);
  if (index <= 0) return items;
  const pinned = items.at(index);
  if (pinned === undefined) return items;
  return [pinned, ...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Rule-passing outfit candidates from seeded random draws (ruling P4-R13), so the list spreads
 * over the closet instead of exhausting one pair of shoes and one top first. Each draw picks
 * shoes, then top + bottom or a one-piece (weighted by how many garments can fill each: half the
 * tops and bottoms against the one-pieces), outerwear when the weather calls for it and the
 * closet has an admissible piece (P4-R7), and an optional bag or accessory, where "none" weighs
 * as much as all the extras together. Each slot's pool holds only pieces that pass the per-piece
 * rules (`fitsAlone`), so a few admissible garments in a large closet are always reachable and a
 * draw can only fail on colors or patterns. Duplicates are dropped; drawing stops at `limit`
 * candidates or after `limit × 20` draws in total. Items worn in the last 7 days are avoided while
 * at least 3 candidates survive without them: that first pass may use half the draws, the
 * fallback pass the rest. Deterministic for a given seed and closet order.
 *
 * `pinnedIds`, when given, also biases every `PIN_ATTEMPT_STRIDE`th draw to pick one of them for
 * its own slot instead of a random one — lucky-list asks for this on the garments pinned for
 * today (see "Unused for 6 months" and "Wear it" in `global-constraints.md`), which a plain
 * seeded draw can otherwise miss across many seeds on a large closet. Only the pinned garments
 * that pass `fitsAlone` for this context are rotated through the forced attempts (one per attempt,
 * round-robin); an inadmissible pin (wrong season, formality, or an outerwear piece on a hot day)
 * never claims a forced attempt, so it can't starve an admissible sibling pin out of them. An
 * admissible pinned garment is also exempt from the 7-day recent-wear exclusion in the first pass
 * (a wear logged between the "Wear it" tap and the pinned day shouldn't silently drop the pin),
 * and a pinned outerwear piece is still tried on forced attempts even when the weather doesn't
 * call for outerwear (`passesRules` allows outerwear any day; it only requires it when cold). The
 * bias changes which garment a few draws use, not how many draws happen or how the rest of the
 * outfit is picked, so it only shifts the pinned garments' own odds, not the overall distribution.
 * `lucky-list` still re-checks that at least one of the returned candidates actually contains a
 * pin before treating it as pinned (a pinned garment might not fit any rule-passing outfit at all).
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

  // Computed once from the closet (P4-R7): "available" means admissible for this context, using
  // the same `isAdmissible` check `passesRules` applies per piece, so an inadmissible-only coat
  // behaves the same as owning none.
  const admissibleOuterwear = groups.outerwear.filter((item) => isAdmissible(item, ctx));
  const outerwearAvailable = admissibleOuterwear.length > 0;
  const ctxWithOuterwear: RuleContext = { ...ctx, outerwearAvailable };
  const needsOuterwear =
    outerwearAvailable &&
    ctx.weather !== null &&
    (ctx.weather.band === 'cold' || (ctx.weather.rain && ctx.weather.band !== 'hot'));

  // Only pins `fitsAlone` admits for this context ever claim a forced attempt (M3): an
  // inadmissible pin (the wrong season, formality, or a coat on a hot day) would otherwise waste
  // every 4th attempt on a garment that can never appear, starving an admissible sibling pin.
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
    // M4: an admissible pinned garment is kept even if it was worn recently — a wear logged
    // between the "Wear it" tap and the pinned day shouldn't silently drop it from every draw.
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
      // Round-robins the forced garment across every admissible pin, one per forced attempt, so
      // several simultaneous pins each get a fair share of the bias rather than only the first.
      const forcedPin =
        admissiblePins.length > 0 && attemptCount % PIN_ATTEMPT_STRIDE === 0
          ? (admissiblePins.at(Math.floor(attemptCount / PIN_ATTEMPT_STRIDE) % admissiblePins.length) ?? null)
          : null;
      attemptCount += 1;
      const pinnedId = forcedPin?.id ?? null;

      // I1: a pinned outerwear piece is tried even when the weather doesn't call for outerwear —
      // `passesRules` allows outerwear on any day, it only requires it when cold.
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
