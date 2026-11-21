// A trip's day-by-day outfits and packing list from the lucky rules, ranked by reuse and the
// pre-score only (docs/ai.md#trip-packing). Pure: no network, no model.

import { type Occasion, type Slot, SLOTS, slotOf } from './catalog.ts';
import { basePieces, generateCandidates, type Outfit, preScore, type RuleGarment, seasonOf } from './outfitRules.ts';
import type { WeatherSummary } from './weather.ts';

export type TripDayWeather = { date: string; weather: WeatherSummary | null };

/** `garmentIds` is null when no outfit passes that day's rules. */
export type TripDay = { date: string; weather: WeatherSummary | null; garmentIds: string[] | null };

export type PackingItem = { garmentId: string; days: number };

export type PackingGroup = { slot: Slot; items: PackingItem[] };

export type TripContext = {
  occasion: Occasion | null;
  /** The destination's latitude, for the season rule; null skips it. */
  lat: number | null;
  /** Seeds each day's draw (with the date), so a trip plans the same way again. */
  seed: string;
  /** Dismissed combinations: the sorted garment ids joined by commas. */
  dismissed: ReadonlySet<string>;
};

const MS_PER_DAY = 86_400_000;

/** Every `YYYY-MM-DD` from `start` to `end`, both included. */
export function tripDates(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  const dates: string[] = [];
  for (let day = first; day <= last; day += MS_PER_DAY) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}

const keyOf = (pieces: readonly RuleGarment[]): string =>
  pieces
    .map((garment) => garment.id)
    .sort()
    .join(',');

/** The candidate that packs the fewest new pieces, then repeats no earlier day's base, then the best pre-score. */
function pickFor(candidates: readonly Outfit[], date: string, packed: ReadonlySet<string>, usedBases: ReadonlySet<string>): Outfit | null {
  const ranked = candidates
    .map((outfit, index) => ({
      outfit,
      index,
      repeat: usedBases.has(keyOf(basePieces(outfit))) ? 1 : 0,
      added: outfit.filter((garment) => !packed.has(garment.id)).length,
      pre: preScore(outfit, date),
    }))
    .sort((a, b) => a.repeat - b.repeat || a.added - b.added || b.pre - a.pre || a.index - b.index);
  return ranked[0]?.outfit ?? null;
}

/** Each piece once, grouped in `SLOTS` order; within a group the most-worn first, then by id. */
function packingOf(days: readonly TripDay[], closet: ReadonlyMap<string, RuleGarment>): PackingGroup[] {
  const worn = new Map<string, number>();
  for (const day of days) for (const id of day.garmentIds ?? []) worn.set(id, (worn.get(id) ?? 0) + 1);
  return SLOTS.flatMap((slot) => {
    const items = [...worn]
      .filter(([id]) => {
        const category = closet.get(id)?.category ?? null;
        return category !== null && slotOf(category) === slot;
      })
      .map(([garmentId, count]) => ({ garmentId, days: count }))
      .sort((a, b) => b.days - a.days || (a.garmentId < b.garmentId ? -1 : 1));
    return items.length === 0 ? [] : [{ slot, items }];
  });
}

/**
 * Day by day, `generateCandidates` under that day's weather and season (its date as "today"),
 * minus dismissed combinations and unsuggested pieces, then `pickFor` against what's packed so far.
 */
export function planTrip(
  garments: readonly RuleGarment[],
  days: readonly TripDayWeather[],
  ctx: TripContext,
): { days: TripDay[]; packing: PackingGroup[] } {
  const suggestable = garments.filter((garment) => garment.suggest);
  const closet = new Map(garments.map((garment) => [garment.id, garment]));
  const packed = new Set<string>();
  const usedBases = new Set<string>();
  const planned = days.map(({ date, weather }): TripDay => {
    const rules = { occasion: ctx.occasion, season: seasonOf(date, ctx.lat), weather, today: date };
    const candidates = generateCandidates(suggestable, rules, ctx.seed + date).filter((outfit) => !ctx.dismissed.has(keyOf(outfit)));
    const outfit = pickFor(candidates, date, packed, usedBases);
    if (outfit === null) return { date, weather, garmentIds: null };
    for (const garment of outfit) packed.add(garment.id);
    usedBases.add(keyOf(basePieces(outfit)));
    return { date, weather, garmentIds: outfit.map((garment) => garment.id) };
  });
  return { days: planned, packing: packingOf(planned, closet) };
}
