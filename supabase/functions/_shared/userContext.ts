// What the user-called outfit functions (`rate-outfit`, `lucky-list`) share: who is calling, the
// caller's profile and garments (read with the caller's own token, so RLS applies), today's
// weather (cached per location and UTC hour), the daily quota, the result caches (service role),
// the Jev and Claude calls with their timeouts, and a concurrency-limited map.
//
// Runtime-neutral: every effect goes through the injected `fetch`, and only web-standard globals
// (`crypto.subtle`, `atob`, `TextEncoder`, `AbortController`) are used, so Jest drives it under
// Node and the Edge Functions run it under Deno.

import {
  type ClothingType,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  GARMENT_FITS,
  GARMENT_PATTERNS,
  type Occasion,
  type Season,
  SEASONS,
  slotOf,
} from './catalog.ts';
import { isRecord } from './extraction.ts';
import type { GarmentStatus, RuleGarment } from './outfitRules.ts';
import {
  type AgeGroup,
  type BodyType,
  buildJevRequest,
  composeRating,
  heightBucket,
  neutralizeUnknownWeather,
  parseJevAnswers,
  type RatingAnswers,
  type RatingLabel,
  RATING_LEVELS,
  type RatingState,
  type Style,
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

export type FnEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  typesafeApiKey: string;
  typesafeBaseUrl: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  openMeteoUrl: string;
  geocodingUrl: string;
};

type FetchFn = typeof fetch;

export const JEV_TIMEOUT_MS = 10_000;
export const CLAUDE_TIMEOUT_MS = 20_000;
export const WEATHER_TIMEOUT_MS = 5_000;
/** At most this many Jev requests at once per function invocation. */
export const MAX_CONCURRENT_JEV = 5;
const ANTHROPIC_VERSION = '2023-06-01';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real calendar date written `YYYY-MM-DD` (the client's local day, as the functions take it). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** A PostgREST or RPC call answered with something other than success. */
export class UpstreamError extends Error {}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

// --- Caller ------------------------------------------------------------------------------------

/**
 * The `sub` of the bearer token, without verifying the signature: with `verify_jwt` on, the
 * gateway has already verified it before the function runs. Null for anything that isn't a
 * bearer JWT whose `sub` is a uuid (the anon and service-role keys have no `sub`).
 */
export function userIdFromJwt(authHeader: string | null): string | null {
  if (authHeader === null) return null;
  const [scheme, jwt, ...rest] = authHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || jwt === undefined || rest.length > 0) return null;
  const [, payload] = jwt.split('.');
  if (payload === undefined || payload === '') return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!isRecord(claims) || typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return null;
    return claims.sub.toLowerCase();
  } catch {
    return null;
  }
}

// --- PostgREST ---------------------------------------------------------------------------------

function userHeaders(env: FnEnv, auth: string): Record<string, string> {
  return { apikey: env.anonKey, authorization: auth };
}

function serviceHeaders(env: FnEnv): Record<string, string> {
  return { apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` };
}

async function restJson(fetchFn: FetchFn, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchFn(url, init);
  if (!response.ok) throw new UpstreamError(`HTTP ${String(response.status)}`);
  return (await response.json()) as unknown;
}

async function restRows(fetchFn: FetchFn, url: string, headers: Record<string, string>): Promise<unknown[]> {
  const rows = await restJson(fetchFn, url, { headers });
  if (!Array.isArray(rows)) throw new UpstreamError('not an array');
  return rows as unknown[];
}

/** POST with `Prefer: resolution=merge-duplicates`: an insert that updates the row on a primary-key conflict. */
async function upsert(env: FnEnv, fetchFn: FetchFn, table: string, row: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetchFn(`${env.supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        ...serviceHeaders(env),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
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

const PROFILE_COLUMNS = 'clothing_type,body_type,height_cm,age_group,styles,city_name,city_lat,city_lon,updated_at';

// The enums are Postgres-checked; the casts only narrow strings the database already validated.
function profileFrom(row: Record<string, unknown>): ProfileRow {
  return {
    clothing_type: oneOf(['feminine', 'masculine', 'everything'], row.clothing_type),
    body_type: stringOrNull(row.body_type) as BodyType | null,
    height_cm: numberOrNull(row.height_cm),
    age_group: stringOrNull(row.age_group) as AgeGroup | null,
    styles: strings(row.styles) as Style[],
    city_name: stringOrNull(row.city_name),
    city_lat: numberOrNull(row.city_lat),
    city_lon: numberOrNull(row.city_lon),
    updated_at: stringOrNull(row.updated_at),
  };
}

/** The caller's profile, read with the caller's token; null when the row doesn't exist. */
export async function loadProfile(env: FnEnv, fetchFn: FetchFn, auth: string): Promise<ProfileRow | null> {
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

const GARMENT_COLUMNS = 'id,category,colors,pattern,formality,seasons,warmth,fit,status,last_worn_at,updated_at';
const GARMENT_STATUSES = ['available', 'laundry', 'lent'] as const satisfies readonly GarmentStatus[];

function garmentFrom(row: unknown): RuleGarment {
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
    updated_at: row.updated_at,
  };
}

/**
 * The caller's garments (only `ids` when given), read with the caller's token: RLS hides other
 * users' garments, so a foreign or deleted id is simply absent from the result.
 */
export async function loadGarments(
  env: FnEnv,
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

/** A `weather_cache.payload` (`{ weather, lat, lon }`), or null when it isn't one. */
function cachedWeatherFrom(payload: unknown): { weather: WeatherSummary; lat: number } | null {
  if (!isRecord(payload) || !isRecord(payload.weather)) return null;
  const { tempC, condition, band, rain } = payload.weather;
  const lat = numberOrNull(payload.lat);
  const knownCondition = oneOf(WEATHER_CONDITIONS, condition);
  const knownBand = oneOf(WEATHER_BANDS, band);
  if (typeof tempC !== 'number' || knownCondition === null || knownBand === null || typeof rain !== 'boolean' || lat === null) {
    return null;
  }
  return { weather: { tempC, condition: knownCondition, band: knownBand, rain }, lat };
}

async function readWeatherCache(
  env: FnEnv,
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

/** GET a JSON body with a timeout; null on a non-2xx answer, a network error or the timeout. */
async function fetchJson(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today's weather at the profile's city plus the latitude the season's hemisphere comes from
 * (the profile's, else the geocoded one; null when unknown). Reads `weather_cache` for the
 * current UTC hour first; on a miss it geocodes a city without coordinates, fetches the forecast
 * and upserts the cache (best effort: a failed write still returns the weather). No city, a
 * city that can't be geocoded, or any Open-Meteo failure gives `weather: null`, never a throw.
 */
export async function getLocalWeather(
  env: FnEnv,
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
        geocodeUrl(`${trimSlash(env.geocodingUrl)}/v1/search`, profile.city_name.trim()),
        {},
        WEATHER_TIMEOUT_MS,
      );
      coords = parseGeocode(body);
    }
    if (coords === null) return { weather: null, lat };
    lat = coords.lat;

    const forecast = await fetchJson(
      fetchFn,
      forecastUrl(`${trimSlash(env.openMeteoUrl)}/v1/forecast`, coords.lat, coords.lon),
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

/** `getLocalWeather` without the latitude. */
export async function getWeather(
  env: FnEnv,
  fetchFn: FetchFn,
  profile: WeatherProfile,
  now: Date = new Date(),
): Promise<WeatherSummary | null> {
  return (await getLocalWeather(env, fetchFn, profile, now)).weather;
}

// --- Quota and result caches -------------------------------------------------------------------

/** `public.consume_quota` for the caller; throws when the RPC itself fails. */
export async function consumeQuota(
  env: FnEnv,
  fetchFn: FetchFn,
  userId: string,
  kind: 'rating' | 'lucky',
  limit: number,
): Promise<boolean> {
  const allowed = await restJson(fetchFn, `${env.supabaseUrl}/rest/v1/rpc/consume_quota`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit }),
  });
  return allowed === true;
}

export type ResultCache = 'rating_cache' | 'lucky_cache';

/** How long a result marked `degraded: true` (a fallback, a skipped or failed step) is served from the cache. */
export const DEGRADED_TTL_MS = 60 * 60 * 1000;

/**
 * The cached `result`, or null on a miss or any error (a failed read just recomputes). A result
 * marked `degraded: true` counts as a miss once it is older than `DEGRADED_TTL_MS` (or its age is
 * unknown), so a better answer is tried again; any other result never expires (ruling P4-R12).
 * The marker is returned as stored; callers strip it before answering.
 */
export async function cacheGet(
  env: FnEnv,
  fetchFn: FetchFn,
  table: ResultCache,
  userId: string,
  key: string,
  now: number = Date.now(),
): Promise<unknown> {
  try {
    const rows = await restRows(
      fetchFn,
      `${env.supabaseUrl}/rest/v1/${table}?select=result,created_at&user_id=eq.${userId}&cache_key=eq.${encodeURIComponent(key)}`,
      serviceHeaders(env),
    );
    const [row] = rows;
    if (!isRecord(row) || row.result === undefined || row.result === null) return null;
    if (isRecord(row.result) && row.result.degraded === true) {
      const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN;
      if (Number.isNaN(createdAt) || now - createdAt > DEGRADED_TTL_MS) return null;
    }
    return row.result;
  } catch {
    return null;
  }
}

/**
 * Upserts a cached result; false (never a throw) when the write fails. `created_at` is written
 * explicitly: a merge-duplicates upsert only updates the columns sent, so a recomputed entry
 * would otherwise keep its old age and a degraded one would never be served.
 */
export function cachePut(
  env: FnEnv,
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

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// --- Models ------------------------------------------------------------------------------------

/** The System One response body, or null on a non-2xx answer, a network error or 10 s passing. */
export function runJev(env: FnEnv, fetchFn: FetchFn, request: unknown): Promise<unknown> {
  return fetchJson(
    fetchFn,
    `${trimSlash(env.typesafeBaseUrl)}/v1/systemone`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.typesafeApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    JEV_TIMEOUT_MS,
  );
}

/** The Messages API response body, or null on a non-2xx answer, a network error or 20 s passing. */
export function runClaude(env: FnEnv, fetchFn: FetchFn, request: unknown): Promise<unknown> {
  return fetchJson(
    fetchFn,
    `${trimSlash(env.anthropicBaseUrl)}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    CLAUDE_TIMEOUT_MS,
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
 * The `RatingState` for an outfit, picking each field explicitly: a profile row (or a garment
 * row) carrying more columns than these never leaks them to a model. Pieces without a category
 * are skipped; callers reject such outfits first.
 */
export function ratingState(
  profile: ProfileRow | null,
  context: { occasion: Occasion | null; weather: WeatherSummary | null; season: Season },
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
  env: FnEnv,
  fetchFn: FetchFn,
  state: RatingState,
  rand: () => number,
): Promise<ComposedRating | null> {
  const parsed = parseJevAnswers(await runJev(env, fetchFn, buildJevRequest(state, rand)), RATING_LEVELS);
  return parsed === null ? null : composeAnswers(parsed, state.context.weather);
}
