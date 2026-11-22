// A trip's outfits and packing list from the closet, the destination's forecast and the lucky rules,
// with no model call: docs/ai.md#trip-packing. Logs carry only an outcome word.

import { OCCASIONS, type Occasion, SLOTS, type Slot } from '../_shared/catalog.ts';
import type { SupabaseEnv, WeatherEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, fetchWithDeadline, readJson, reply } from '../_shared/http.ts';
import { garmentFingerprint, missingSlots, type RuleGarment } from '../_shared/outfitRules.ts';
import { type PackingGroup, planTrip, type TripDay, tripDates } from '../_shared/tripPlan.ts';
import {
  cacheFresh,
  cachePut,
  cacheRead,
  consumeQuota,
  geocodePlace,
  isIsoDate,
  loadDismissed,
  loadGarments,
  sha256Hex,
  WEATHER_TIMEOUT_MS,
  weatherSummaryFrom,
} from '../_shared/userContext.ts';
import { dailyForecastUrl, parseDailyForecast, type WeatherSummary } from '../_shared/weather.ts';

export type TripEnv = SupabaseEnv & WeatherEnv;

export type TripDeps = { env: TripEnv; fetch: typeof fetch; now?: () => number };

export type { PackingGroup, TripDay };

export type TripResponse =
  | { kind: 'too_small'; missing: Slot[] }
  | { kind: 'ok'; city: string; days: TripDay[]; packing: PackingGroup[] };

type OkResponse = Extract<TripResponse, { kind: 'ok' }>;

/** The answer plus the internal `degraded` marker (the forecast failed), stripped before answering. */
type CachedTrip = OkResponse & { degraded: boolean };

export const TRIP_DAILY_LIMIT = 5;
/** A trip's answer is reused this long; `prune_expired_caches()` drops `trip_cache` rows after 7 hours. */
export const TRIP_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TRIP_DAYS = 10;
const MAX_CITY_LENGTH = 100;
/** How far ahead a trip may start; past the forecast its days use the season rule alone. */
const MAX_START_AHEAD_DAYS = 365;
const MS_PER_DAY = 86_400_000;
const CACHE_VERSION = 1;
const LANGUAGES = ['en', 'es'] as const;

type TripInput = { city: string; start: string; end: string; occasion: Occasion | null; language: string; date: string };

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;

/**
 * Null when malformed. `date` is the app's local day (the quota's day). The start may be one day
 * before the server's UTC date (a time zone behind it) and at most a year after.
 */
async function readInput(request: Request, now: number): Promise<TripInput | null> {
  const body = await readJson(request);
  if (!isRecord(body)) return null;
  const { city, start, end, occasion, language, date } = body;
  if (typeof city !== 'string' || city.trim() === '' || city.trim().length > MAX_CITY_LENGTH) return null;
  if (!isIsoDate(start) || !isIsoDate(end) || !isIsoDate(date)) return null;
  const knownOccasion = OCCASIONS.find((candidate) => candidate === occasion);
  if (occasion !== undefined && occasion !== null && knownOccasion === undefined) return null;
  const knownLanguage = LANGUAGES.find((candidate) => candidate === language);
  if (knownLanguage === undefined) return null;
  const length = dayNumber(end) - dayNumber(start) + 1;
  const ahead = dayNumber(start) - Math.floor(now / MS_PER_DAY);
  if (length < 1 || length > MAX_TRIP_DAYS || ahead < -1 || ahead > MAX_START_AHEAD_DAYS) return null;
  return { city: city.trim(), start, end, occasion: knownOccasion ?? null, language: knownLanguage, date };
}

const byId = (a: RuleGarment, b: RuleGarment): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The trip (the city lowercased with its spaces collapsed), the candidate garments' rating-relevant
 * columns with `suggest`, and the dismissed combinations. Wear dates aren't in it: a wear would
 * otherwise spend the quota again for the same trip.
 */
function cacheKey(garments: readonly RuleGarment[], dismissed: ReadonlySet<string>, input: TripInput): Promise<string> {
  const fingerprint = garments
    .filter((g) => g.category !== null && g.status === 'available')
    .sort(byId)
    .map((g) => [...garmentFingerprint(g), g.suggest]);
  return sha256Hex(
    JSON.stringify({
      v: CACHE_VERSION,
      city: input.city.toLowerCase().replace(/\s+/g, ' '),
      start: input.start,
      end: input.end,
      occasion: input.occasion,
      language: input.language,
      fingerprint,
      dismissed: [...dismissed].sort(),
    }),
  );
}

function isDay(value: unknown, closet: ReadonlyMap<string, RuleGarment>): value is TripDay {
  if (!isRecord(value) || !isIsoDate(value.date)) return false;
  if (value.weather !== null && weatherSummaryFrom(value.weather) === null) return false;
  const ids: unknown = value.garmentIds;
  return ids === null || (Array.isArray(ids) && ids.every((id) => typeof id === 'string' && closet.has(id)));
}

function isGroup(value: unknown, closet: ReadonlyMap<string, RuleGarment>): value is PackingGroup {
  return (
    isRecord(value) &&
    SLOTS.some((slot) => slot === value.slot) &&
    Array.isArray(value.items) &&
    value.items.every((item: unknown) => isRecord(item) && typeof item.garmentId === 'string' && closet.has(item.garmentId) && typeof item.days === 'number')
  );
}

/** A stored answer of this closet, without its marker; null (a miss) for anything else. */
function fromCache(cached: unknown, closet: ReadonlyMap<string, RuleGarment>): OkResponse | null {
  if (!isRecord(cached) || cached.kind !== 'ok' || typeof cached.city !== 'string') return null;
  const { days, packing } = cached;
  if (!Array.isArray(days) || !days.every((day) => isDay(day, closet))) return null;
  if (!Array.isArray(packing) || !packing.every((group) => isGroup(group, closet))) return null;
  return { kind: 'ok', city: cached.city, days, packing };
}

/** Each forecast day's summary, or null when Open-Meteo fails (every day then goes without weather). */
async function dailyForecast(env: WeatherEnv, fetchFn: typeof fetch, lat: number, lon: number): Promise<Map<string, WeatherSummary> | null> {
  try {
    const response = await fetchWithDeadline(fetchFn, dailyForecastUrl(`${env.openMeteoUrl}/v1/forecast`, lat, lon), {}, WEATHER_TIMEOUT_MS);
    return response.ok ? parseDailyForecast((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

export async function handleTripPlan(request: Request, deps: TripDeps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
  const input = await readInput(request, now);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, dismissed] = await Promise.all([loadGarments(env, fetchFn, auth), loadDismissed(env, fetchFn, auth)]);
    const missing = missingSlots(garments);
    if (missing.length > 0) return reply('too_small', 200, { kind: 'too_small', missing } satisfies TripResponse);

    const key = await cacheKey(garments, dismissed, input);
    const closet = new Map(garments.map((garment) => [garment.id, garment]));
    const row = await cacheRead(env, fetchFn, 'trip_cache', userId, key);
    const hit = row !== null && cacheFresh(row, now, TRIP_TTL_MS) ? fromCache(row.result, closet) : null;
    if (hit !== null) return reply('cached', 200, hit);

    if (!(await consumeQuota(env, fetchFn, userId, 'trip', TRIP_DAILY_LIMIT, input.date))) {
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    const place = await geocodePlace(env, fetchFn, input.city, input.language);
    if (place === 'not_found') return reply('not_found', 404, { error: 'city_not_found' });
    if (place === 'failed') return reply('unavailable', 503, { error: 'geocoding_unavailable' });

    const forecast = await dailyForecast(env, fetchFn, place.lat, place.lon);
    const plan = planTrip(
      garments,
      tripDates(input.start, input.end).map((date) => ({ date, weather: forecast?.get(date) ?? null })),
      { occasion: input.occasion, lat: place.lat, seed: userId, dismissed },
    );
    const result: OkResponse = { kind: 'ok', city: place.name, days: plan.days, packing: plan.packing };
    const degraded = forecast === null;
    await cachePut(env, fetchFn, 'trip_cache', userId, key, { ...result, degraded } satisfies CachedTrip, now);
    return reply(degraded ? 'degraded' : 'planned', 200, result);
  } catch {
    // The database itself failed (garments, dismissed outfits or quota); nothing was planned or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
