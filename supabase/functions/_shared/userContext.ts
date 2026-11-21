// Shared by the user-called functions: profile and garments (caller's token, so RLS applies),
// weather (cached per location and UTC hour), quota, result caches (service role), model calls.

import {
  AGE_GROUPS,
  type AgeGroup,
  BODY_TYPES,
  type BodyType,
  type ClothingType,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  GARMENT_FITS,
  GARMENT_PATTERNS,
  type Occasion,
  type Season,
  SEASONS,
  slotOf,
  type Style,
  STYLES,
} from './catalog.ts';
import type { ClaudeEnv, GeocodingEnv, JevEnv, ServiceEnv, SupabaseEnv, WeatherEnv } from './env.ts';
import { isRecord, UUID } from './guards.ts';
import { fetchWithDeadline, userIdFromJwt } from './http.ts';
import type { GarmentStatus, RuleGarment } from './outfitRules.ts';
import {
  buildJevRequest,
  composeRating,
  heightBucket,
  neutralizeUnknownWeather,
  parseJevAnswers,
  type RatingAnswers,
  type RatingLabel,
  RATING_LEVELS,
  type RatingState,
} from './rating.ts';
import {
  forecastUrl,
  geocodeUrl,
  locationKey,
  parseForecast,
  parseGeocode,
  type WeatherBand,
  type WeatherCondition,
  type WeatherSummary,
} from './weather.ts';

type FetchFn = typeof fetch;

export const JEV_TIMEOUT_MS = 10_000;
export const CLAUDE_TIMEOUT_MS = 20_000;
export const WEATHER_TIMEOUT_MS = 5_000;
/** Every PostgREST call; the database answers in milliseconds, so this only bounds a hung connection. */
export const POSTGREST_TIMEOUT_MS = 8_000;
/** Per function invocation. */
export const MAX_CONCURRENT_JEV = 5;
const ANTHROPIC_VERSION = '2023-06-01';

/** A real calendar date written `YYYY-MM-DD` from year 0001 on (Postgres has no year 0). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export class UpstreamError extends Error {}

// --- PostgREST ---------------------------------------------------------------------------------

/** Headers for a request made as the caller: RLS applies. */
export function userHeaders(env: SupabaseEnv, auth: string): Record<string, string> {
  return { apikey: env.anonKey, authorization: auth };
}

/** Headers for a request made with the service role, which bypasses RLS. */
export function serviceHeaders(env: Pick<ServiceEnv, 'serviceRoleKey'>): Record<string, string> {
  return { apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` };
}

/** One call's JSON answer, bounded by `timeoutMs` (a hung connection can't hold the function); throws on non-2xx. */
export async function restJson(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs = POSTGREST_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchWithDeadline(fetchFn, url, init, timeoutMs);
  if (!response.ok) throw new UpstreamError(`HTTP ${String(response.status)}`);
  return (await response.json()) as unknown;
}

export async function restRows(fetchFn: FetchFn, url: string, headers: Record<string, string>): Promise<unknown[]> {
  const rows = await restJson(fetchFn, url, { headers });
  if (!Array.isArray(rows)) throw new UpstreamError('not an array');
  return rows as unknown[];
}

/** An insert that updates the row on a primary-key conflict. */
export async function upsert(
  env: ServiceEnv,
  fetchFn: FetchFn,
  table: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await fetchWithDeadline(
      fetchFn,
      `${env.supabaseUrl}/rest/v1/${table}`,
      {
        method: 'POST',
        headers: {
          ...serviceHeaders(env),
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
      },
      POSTGREST_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    return false;
  }
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
  allowed.find((candidate) => candidate === value) ?? null;

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? (value as unknown[]).filter((item): item is string => typeof item === 'string') : [];

// --- Profile -----------------------------------------------------------------------------------

/** The profile columns the outfit functions read; never measurements other than the height. */
export type ProfileRow = {
  clothing_type: ClothingType | null;
  body_type: BodyType | null;
  height_cm: number | null;
  age_group: AgeGroup | null;
  styles: Style[];
  city_name: string | null;
  city_lat: number | null;
  city_lon: number | null;
  updated_at: string | null;
};

export const PROFILE_COLUMNS = 'clothing_type,body_type,height_cm,age_group,styles,city_name,city_lat,city_lon,updated_at';

/**
 * The profile fields an outfit result depends on, for the cache keys: not `updated_at` (a language
 * toggle would throw away results and spend quota) nor the city name (it only labels the weather).
 */
export function profileIdentity(profile: ProfileRow | null): string {
  if (profile === null) return 'null';
  return JSON.stringify([
    profile.clothing_type,
    profile.body_type,
    profile.height_cm,
    profile.age_group,
    [...profile.styles].sort(),
    profile.city_lat,
    profile.city_lon,
  ]);
}

// Postgres already checks these enums; re-checking them here means only enum members, never free
// text, can reach the Jev and Claude requests built from the profile.
export function profileFrom(row: Record<string, unknown>): ProfileRow {
  return {
    clothing_type: oneOf(['feminine', 'masculine', 'everything'], row.clothing_type),
    body_type: oneOf(BODY_TYPES, row.body_type),
    height_cm: numberOrNull(row.height_cm),
    age_group: oneOf(AGE_GROUPS, row.age_group),
    styles: strings(row.styles).flatMap((style) => oneOf(STYLES, style) ?? []),
    city_name: stringOrNull(row.city_name),
    city_lat: numberOrNull(row.city_lat),
    city_lon: numberOrNull(row.city_lon),
    updated_at: stringOrNull(row.updated_at),
  };
}

/** Null when the row doesn't exist. */
export async function loadProfile(env: SupabaseEnv, fetchFn: FetchFn, auth: string): Promise<ProfileRow | null> {
  const userId = userIdFromJwt(auth);
  if (userId === null) return null;
  const rows = await restRows(
    fetchFn,
    `${env.supabaseUrl}/rest/v1/profiles?select=${PROFILE_COLUMNS}&user_id=eq.${userId}`,
    userHeaders(env, auth),
  );
  const [row] = rows;
  return isRecord(row) ? profileFrom(row) : null;
}

// --- Garments ----------------------------------------------------------------------------------

export const GARMENT_COLUMNS =
  'id,category,colors,pattern,formality,seasons,warmth,fit,status,last_worn_at,wear_count,suggest,updated_at,pinned_on';
const GARMENT_STATUSES = ['available', 'laundry', 'lent', 'donated'] as const satisfies readonly GarmentStatus[];

/** `pinned_on`, read as a plain `YYYY-MM-DD` the way the lucky-list cache key and request dates are compared. */
const pinnedOnOf = (value: unknown): string | null => (isIsoDate(value) ? value : null);

export function garmentFrom(row: unknown): RuleGarment {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.updated_at !== 'string') {
    throw new UpstreamError('garments: unexpected row');
  }
  const status = oneOf(GARMENT_STATUSES, row.status);
  if (status === null) throw new UpstreamError('garments: unexpected status');
  return {
    id: row.id.toLowerCase(),
    category: oneOf(GARMENT_CATEGORIES, row.category),
    colors: strings(row.colors).flatMap((color) => oneOf(GARMENT_COLORS, color) ?? []),
    pattern: oneOf(GARMENT_PATTERNS, row.pattern),
    formality: numberOrNull(row.formality),
    seasons: strings(row.seasons).flatMap((season) => oneOf(SEASONS, season) ?? []),
    warmth: numberOrNull(row.warmth),
    fit: oneOf(GARMENT_FITS, row.fit),
    status,
    last_worn_at: stringOrNull(row.last_worn_at),
    wear_count: typeof row.wear_count === 'number' && Number.isInteger(row.wear_count) && row.wear_count > 0 ? row.wear_count : 0,
    // Only an explicit false opts out: the column is `not null default true`.
    suggest: row.suggest !== false,
    updated_at: row.updated_at,
    pinned_on: pinnedOnOf(row.pinned_on),
  };
}

/** The caller's garments (only `ids` when given); RLS drops a foreign or deleted id silently. */
export async function loadGarments(
  env: SupabaseEnv,
  fetchFn: FetchFn,
  auth: string,
  ids?: readonly string[],
): Promise<RuleGarment[]> {
  if (ids?.some((id) => !UUID.test(id))) throw new UpstreamError('garments: invalid id');
  const filter = ids === undefined ? '' : `&id=in.(${ids.join(',')})`;
  const rows = await restRows(
    fetchFn,
    `${env.supabaseUrl}/rest/v1/garments?select=${GARMENT_COLUMNS}${filter}&order=id`,
    userHeaders(env, auth),
  );
  return rows.map(garmentFrom);
}

// NOTE: reads one page (PostgREST's max_rows, 1000 here), so later dismissals past it are ignored; upgrade: page like export-data.
/** The caller's dismissed outfit keys (sorted garment ids joined by commas), read under RLS. */
export async function loadDismissed(env: SupabaseEnv, fetchFn: FetchFn, auth: string): Promise<Set<string>> {
  const rows = await restRows(fetchFn, `${env.supabaseUrl}/rest/v1/dismissed_outfits?select=outfit_key`, userHeaders(env, auth));
  return new Set(rows.flatMap((row) => (isRecord(row) && typeof row.outfit_key === 'string' ? [row.outfit_key] : [])));
}

// --- Weather -----------------------------------------------------------------------------------

export type WeatherProfile = Pick<ProfileRow, 'city_name' | 'city_lat' | 'city_lon'>;

const WEATHER_CONDITIONS = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'storm'] as const satisfies readonly WeatherCondition[];
const WEATHER_BANDS = ['cold', 'cool', 'mild', 'hot'] as const satisfies readonly WeatherBand[];

/** The top of `now`'s UTC hour, as the ISO string the `weather_cache.hour` key is matched with. */
function utcHour(now: Date): string {
  const hour = new Date(now.getTime());
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

/** A stored `WeatherSummary` (picked field by field), or null when `value` isn't one. */
export function weatherSummaryFrom(value: unknown): WeatherSummary | null {
  if (!isRecord(value)) return null;
  const { tempC, condition, band, rain } = value;
  const knownCondition = oneOf(WEATHER_CONDITIONS, condition);
  const knownBand = oneOf(WEATHER_BANDS, band);
  if (typeof tempC !== 'number' || !Number.isFinite(tempC) || knownCondition === null || knownBand === null || typeof rain !== 'boolean') {
    return null;
  }
  return { tempC, condition: knownCondition, band: knownBand, rain };
}

/** A `weather_cache.payload` (`{ weather, lat, lon }`), or null when it isn't one. */
function cachedWeatherFrom(payload: unknown): { weather: WeatherSummary; lat: number } | null {
  if (!isRecord(payload)) return null;
  const weather = weatherSummaryFrom(payload.weather);
  const lat = numberOrNull(payload.lat);
  return weather === null || lat === null ? null : { weather, lat };
}

async function readWeatherCache(
  env: ServiceEnv,
  fetchFn: FetchFn,
  key: string,
  hour: string,
): Promise<{ weather: WeatherSummary; lat: number } | null> {
  try {
    const rows = await restRows(
      fetchFn,
      `${env.supabaseUrl}/rest/v1/weather_cache?select=payload&location_key=eq.${encodeURIComponent(key)}&hour=eq.${encodeURIComponent(hour)}`,
      serviceHeaders(env),
    );
    const [row] = rows;
    return isRecord(row) ? cachedWeatherFrom(row.payload) : null;
  } catch {
    return null;
  }
}

/** Null on a non-2xx answer, a network error or the timeout. */
async function fetchJson(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetchWithDeadline(fetchFn, url, init, timeoutMs);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** A typed city's latitude from Open-Meteo's geocoding, or null when it can't be found or the call fails. */
export async function geocodedLatitude(env: GeocodingEnv, fetchFn: FetchFn, cityName: string): Promise<number | null> {
  try {
    const body = await fetchJson(fetchFn, geocodeUrl(`${env.geocodingUrl}/v1/search`, cityName.trim()), {}, WEATHER_TIMEOUT_MS);
    return parseGeocode(body)?.lat ?? null;
  } catch {
    return null;
  }
}

/**
 * Today's weather plus the season's latitude (the profile's, else geocoded), via `weather_cache`
 * for the UTC hour (a failed cache write still returns the weather). No city, no geocode or any
 * Open-Meteo failure gives `weather: null`, never a throw.
 */
export async function getLocalWeather(
  env: ServiceEnv & WeatherEnv,
  fetchFn: FetchFn,
  profile: WeatherProfile,
  now: Date = new Date(),
): Promise<{ weather: WeatherSummary | null; lat: number | null }> {
  let lat = profile.city_lat;
  const key = locationKey({ name: profile.city_name, lat: profile.city_lat, lon: profile.city_lon });
  if (key === null) return { weather: null, lat };
  try {
    const hour = utcHour(now);
    const cached = await readWeatherCache(env, fetchFn, key, hour);
    if (cached !== null) return { weather: cached.weather, lat: lat ?? cached.lat };

    let coords = profile.city_lat !== null && profile.city_lon !== null ? { lat: profile.city_lat, lon: profile.city_lon } : null;
    if (coords === null && profile.city_name !== null) {
      const body = await fetchJson(
        fetchFn,
        geocodeUrl(`${env.geocodingUrl}/v1/search`, profile.city_name.trim()),
        {},
        WEATHER_TIMEOUT_MS,
      );
      coords = parseGeocode(body);
    }
    if (coords === null) return { weather: null, lat };
    lat = coords.lat;

    const forecast = await fetchJson(
      fetchFn,
      forecastUrl(`${env.openMeteoUrl}/v1/forecast`, coords.lat, coords.lon),
      {},
      WEATHER_TIMEOUT_MS,
    );
    const weather = parseForecast(forecast);
    if (weather === null) return { weather: null, lat };

    await upsert(env, fetchFn, 'weather_cache', {
      location_key: key,
      hour,
      payload: { weather, lat: coords.lat, lon: coords.lon },
    });
    return { weather, lat };
  } catch {
    return { weather: null, lat };
  }
}

// --- Quota and result caches -------------------------------------------------------------------

/**
 * `public.consume_quota` on `day`, the app's local day (the database falls back to the UTC day when
 * it's over a day off or absent); throws when the RPC fails. The app's busy locks stop double taps.
 * NOTE: concurrent identical misses both spend quota and call the model; upgrade: an advisory lock on the cache key.
 */
export async function consumeQuota(
  env: ServiceEnv,
  fetchFn: FetchFn,
  userId: string,
  kind: 'rating' | 'lucky' | 'for_you' | 'extraction',
  limit: number,
  day?: string,
): Promise<boolean> {
  const allowed = await restJson(fetchFn, `${env.supabaseUrl}/rest/v1/rpc/consume_quota`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit, p_day: day }),
  });
  return allowed === true;
}

export type ResultCache = 'rating_cache' | 'lucky_cache' | 'for_you_cache';

/** How long a `degraded: true` result (a fallback, a skipped or failed step) is served from the cache. */
export const DEGRADED_TTL_MS = 60 * 60 * 1000;

/** A stored cache row: the result as stored (marker included) and its `created_at` in ms, null when unreadable. */
export type CacheRow = { result: unknown; createdAt: number | null };

/** The first row a cache read answered, or null when there is none or any request fails. */
async function firstCacheRow(fetchFn: FetchFn, url: string, env: ServiceEnv): Promise<CacheRow | null> {
  try {
    const [row] = await restRows(fetchFn, url, serviceHeaders(env));
    if (!isRecord(row) || row.result === undefined || row.result === null) return null;
    const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN;
    return { result: row.result, createdAt: Number.isNaN(createdAt) ? null : createdAt };
  } catch {
    return null;
  }
}

/** The stored row for `key` whatever its age, or null on a miss or any error. */
export function cacheRead(
  env: ServiceEnv,
  fetchFn: FetchFn,
  table: ResultCache,
  userId: string,
  key: string,
): Promise<CacheRow | null> {
  return firstCacheRow(
    fetchFn,
    `${env.supabaseUrl}/rest/v1/${table}?select=result,created_at&user_id=eq.${userId}&cache_key=eq.${encodeURIComponent(key)}`,
    env,
  );
}

/** The user's most recently written row, whatever its key or age; null when there is none or on any error. */
export function cacheReadNewest(
  env: ServiceEnv,
  fetchFn: FetchFn,
  table: ResultCache,
  userId: string,
): Promise<CacheRow | null> {
  return firstCacheRow(
    fetchFn,
    `${env.supabaseUrl}/rest/v1/${table}?select=result,created_at&user_id=eq.${userId}&order=created_at.desc&limit=1`,
    env,
  );
}

/** A hit: within `maxAgeMs`, and `DEGRADED_TTL_MS` when degraded; an unknown age is fresh only with neither limit. */
export function cacheFresh(row: CacheRow, now: number, maxAgeMs: number = Number.POSITIVE_INFINITY): boolean {
  const degraded = isRecord(row.result) && row.result.degraded === true;
  const limit = Math.min(maxAgeMs, degraded ? DEGRADED_TTL_MS : Number.POSITIVE_INFINITY);
  if (limit === Number.POSITIVE_INFINITY) return true;
  return row.createdAt !== null && now - row.createdAt <= limit;
}

/**
 * The cached `result`, or null on a miss or any error (a failed read just recomputes). A degraded
 * result expires after `DEGRADED_TTL_MS` (or of unknown age); others never do. Callers strip the marker.
 */
export async function cacheGet(env: ServiceEnv, fetchFn: FetchFn, table: ResultCache, userId: string, key: string): Promise<unknown> {
  const row = await cacheRead(env, fetchFn, table, userId, key);
  return row !== null && cacheFresh(row, Date.now()) ? row.result : null;
}

/**
 * False (never a throw) when the write fails. `created_at` is sent explicitly: a merge-duplicates
 * upsert only updates the columns sent, so a recomputed entry would keep its old age.
 */
export function cachePut(
  env: ServiceEnv,
  fetchFn: FetchFn,
  table: ResultCache,
  userId: string,
  key: string,
  result: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  return upsert(env, fetchFn, table, {
    user_id: userId,
    cache_key: key,
    result,
    created_at: new Date(now).toISOString(),
  });
}

/** Deletes the user's rows under every key but `keep`; best effort, so a failure is ignored. */
export async function cachePrune(
  env: ServiceEnv,
  fetchFn: FetchFn,
  table: ResultCache,
  userId: string,
  keep: string,
): Promise<void> {
  try {
    const filter = `user_id=eq.${userId}&cache_key=neq.${encodeURIComponent(keep)}`;
    await fetchWithDeadline(
      fetchFn,
      `${env.supabaseUrl}/rest/v1/${table}?${filter}`,
      { method: 'DELETE', headers: { ...serviceHeaders(env), prefer: 'return=minimal' } },
      POSTGREST_TIMEOUT_MS,
    );
  } catch {
    // A row left behind is only an older entry; the next write prunes it again.
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// --- Models ------------------------------------------------------------------------------------

/** The System One response body, or null on a non-2xx answer, a network error or 10 s passing. */
export function runJev(env: JevEnv, fetchFn: FetchFn, request: unknown): Promise<unknown> {
  return fetchJson(
    fetchFn,
    `${env.typesafeBaseUrl}/v1/systemone`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.typesafeApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    JEV_TIMEOUT_MS,
  );
}

/** The Messages API response body, or null on a non-2xx answer, a network error or `timeoutMs` passing. */
export function runClaude(
  env: ClaudeEnv,
  fetchFn: FetchFn,
  request: unknown,
  timeoutMs: number = CLAUDE_TIMEOUT_MS,
): Promise<unknown> {
  return fetchJson(
    fetchFn,
    `${env.anthropicBaseUrl}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    timeoutMs,
  );
}

/** Maps `items` through `fn` with at most `limit` calls in flight, keeping the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Map<number, R>();
  // One iterator shared by every worker: each `for…of` step takes the next unclaimed item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) results.set(index, await fn(item));
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return items.map((_, index) => results.get(index)) as R[];
}

// --- Rating ------------------------------------------------------------------------------------

/**
 * The `RatingState`, picking each field explicitly so extra profile or garment columns never reach
 * a model. Pieces without a category are skipped; callers reject such outfits first.
 */
export function ratingState(
  profile: ProfileRow | null,
  context: { occasion: Occasion | null; weather: WeatherSummary | null; season: Season | null },
  outfit: readonly RuleGarment[],
): RatingState {
  const clothingType = profile?.clothing_type ?? null;
  return {
    user: {
      clothing_type: clothingType,
      body_type: profile?.body_type ?? null,
      height_bucket: heightBucket(profile?.height_cm ?? null, clothingType),
      age_group: profile?.age_group ?? null,
      styles: [...(profile?.styles ?? [])],
    },
    context: { occasion: context.occasion, weather: context.weather, season: context.season },
    outfit: outfit.flatMap((garment) =>
      garment.category === null
        ? []
        : [
            {
              slot: slotOf(garment.category),
              category: garment.category,
              colors: [...garment.colors],
              pattern: garment.pattern,
              formality: garment.formality,
              fit: garment.fit,
            },
          ],
    ),
  };
}

export type ComposedRating = { answers: RatingAnswers; score: number; confidence: number; label: RatingLabel };

/** Parsed answers made neutral on unknown weather, then composed into the score. */
export function composeAnswers(parsed: RatingAnswers, weather: WeatherSummary | null): ComposedRating {
  const answers = neutralizeUnknownWeather(parsed, weather);
  return { answers, ...composeRating(answers.dims, answers.hardFailure) };
}

/** One Jev rating of `state`, or null when Jev fails, times out or answers something unparseable. */
export async function jevRating(
  env: JevEnv,
  fetchFn: FetchFn,
  state: RatingState,
  rand: () => number,
): Promise<ComposedRating | null> {
  const parsed = parseJevAnswers(await runJev(env, fetchFn, buildJevRequest(state, rand)), RATING_LEVELS);
  return parsed === null ? null : composeAnswers(parsed, state.context.weather);
}
