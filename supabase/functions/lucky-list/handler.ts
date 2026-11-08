// The `lucky-list` Edge Function's request handler: the day's ranked "feeling lucky" outfits from
// a signed-in user's closet. Rule-passing candidates come from seeded random draws (user id +
// date); the 30 best pre-scored ones, spread over the closet (at most 2 per base, and a
// per-slot cap on each garment while others remain), are rated with Jev and sorted by score; outfits
// whose rating failed (or never started inside the time budget) follow in pre-score order with
// `score: null`.
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node
// and `index.ts` serves it under Deno.
//
// Garments and the profile are read with the caller's own token (RLS applies); the quota,
// `lucky_cache` and the weather cache use the service role. Logs carry only an outcome word,
// never garments, the profile, prompts or model output. See `docs/ai.md`'s "The `lucky-list`
// function".

import { OCCASIONS, type Occasion, type Slot, slotOf } from '../_shared/catalog.ts';
import { isRecord } from '../_shared/extraction.ts';
import {
  basePieces,
  generateCandidates,
  missingSlots,
  type Outfit,
  preScore,
  type RuleContext,
  type RuleGarment,
  seasonOf,
  wornThisWeek,
} from '../_shared/outfitRules.ts';
import {
  cacheGet,
  cachePut,
  consumeQuota,
  type FnEnv,
  getLocalWeather,
  isIsoDate,
  jevRating,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  sha256Hex,
  userIdFromJwt,
  weatherSummaryFrom,
} from '../_shared/userContext.ts';
import { locationKey, type WeatherSummary } from '../_shared/weather.ts';

export type LuckyDeps = { env: FnEnv; fetch: typeof fetch; rand?: () => number };

export type LuckyOutfit = {
  garmentIds: string[];
  /** The Jev composite score, 0..100; null when its rating failed or was cut by the time budget. */
  score: number | null;
  /** No piece was worn in the last 7 days ("Nothing you wore this week"). */
  freshThisWeek: boolean;
};

export type LuckyResponse =
  | { kind: 'too_small'; missing: Slot[]; weather: WeatherSummary | null }
  | { kind: 'ok'; weather: WeatherSummary | null; outfits: LuckyOutfit[] };

type OkResponse = Extract<LuckyResponse, { kind: 'ok' }>;

/**
 * What `lucky_cache` stores: the response plus an internal marker, stripped before answering. A
 * degraded list (a failed or skipped Jev rating, or a forecast that failed for a known location)
 * is served from the cache for an hour only (ruling P4-R12; see `cacheGet`).
 */
type CachedLucky = OkResponse & { degraded: boolean };

type Outcome = 'cached' | 'too_small' | 'ranked' | 'degraded' | 'empty' | 'over_quota' | 'invalid' | 'error';

export const LUCKY_DAILY_LIMIT = 10;
/** How many of the best pre-scored candidates are rated with Jev. */
export const MAX_RANKED = 30;
/** At most this many of the ranked outfits share the same base (the same pieces but the extra; P4-R13). */
export const MAX_PER_BASE = 2;
/**
 * The floor of the per-garment cap among the ranked outfits (raised for a slot with few
 * garments; see `selectForRanking`), applied while enough other candidates remain.
 */
export const MAX_PER_PIECE = 4;
/** No Jev ranking call starts once this long has passed since the request arrived (ruling P4-R11). */
export const RANK_BUDGET_MS = 15_000;
const CACHE_VERSION = 1;

type LuckyInput = { date: string; occasion: Occasion | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: Outcome, status: number, body: unknown): Response {
  console.info(JSON.stringify({ outcome }));
  return json(status, body);
}

async function readInput(request: Request): Promise<LuckyInput | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const { date, occasion } = body;
  const knownOccasion = OCCASIONS.find((candidate) => candidate === occasion);
  if (occasion !== null && knownOccasion === undefined) return null;
  if (!isIsoDate(date)) return null;
  return { date, occasion: knownOccasion ?? null };
}

const byId = (a: RuleGarment, b: RuleGarment): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const locationOf = (profile: ProfileRow | null): string | null =>
  locationKey({ name: profile?.city_name ?? null, lat: profile?.city_lat ?? null, lon: profile?.city_lon ?? null });

/**
 * The cache key. The closet fingerprint hashes each candidate garment's id and rating-relevant
 * columns (not `updated_at` or `last_worn_at`, which logging a wear bumps; ruling P4-R6), so
 * wearing an outfit doesn't reshuffle today's list; `freshThisWeek` is recomputed on every hit
 * instead.
 */
function cacheKey(garments: readonly RuleGarment[], profile: ProfileRow | null, input: LuckyInput): Promise<string> {
  // Only garments that can be candidates count (P4-R15): an upload still being read (no category
  // yet) or a piece in the laundry or lent can't change today's list, so it doesn't change the key.
  const fingerprint = garments
    .filter((g) => g.category !== null && g.status === 'available')
    .sort(byId)
    .map((g) => [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth, g.status]);
  return sha256Hex(
    JSON.stringify({
      v: CACHE_VERSION,
      date: input.date,
      occasion: input.occasion,
      location: locationOf(profile),
      fingerprint,
      profile: profile?.updated_at ?? null,
    }),
  );
}

/**
 * A cached list answered against today's closet and weather: `freshThisWeek` from the current
 * wear dates, and this request's weather when it has one (else the validated stored one). The
 * list itself stays as ranked. Null (a miss) when the entry isn't a well-formed list of this
 * closet's garments.
 */
function fromCache(
  cached: unknown,
  closet: ReadonlyMap<string, RuleGarment>,
  date: string,
  current: WeatherSummary | null,
): OkResponse | null {
  if (!isRecord(cached) || cached.kind !== 'ok' || !Array.isArray(cached.outfits)) return null;
  const outfits: LuckyOutfit[] = [];
  for (const entry of cached.outfits as unknown[]) {
    if (!isRecord(entry) || !Array.isArray(entry.garmentIds)) return null;
    const { score } = entry;
    if (score !== null && typeof score !== 'number') return null;
    const pieces: RuleGarment[] = [];
    for (const id of entry.garmentIds as unknown[]) {
      const piece = typeof id === 'string' ? closet.get(id) : undefined;
      if (piece === undefined) return null;
      pieces.push(piece);
    }
    outfits.push({ garmentIds: pieces.map((piece) => piece.id), score, freshThisWeek: !wornThisWeek(pieces, date) });
  }
  return { kind: 'ok', weather: current ?? weatherSummaryFrom(cached.weather), outfits };
}

type RankContext = {
  env: FnEnv;
  fetch: typeof fetch;
  rand: () => number;
  profile: ProfileRow | null;
  occasion: Occasion | null;
  weather: WeatherSummary | null;
  rules: RuleContext;
  startedAt: number;
};

/**
 * Rates each candidate with Jev (at most `MAX_CONCURRENT_JEV` at once) and sorts them: rated
 * ones by score, highest first, then the rest in their input (pre-score) order. No rating
 * starts after `RANK_BUDGET_MS`; `complete` is false when any rating failed or was skipped.
 */
async function rank(ctx: RankContext, candidates: readonly Outfit[]): Promise<{ ranked: LuckyOutfit[]; complete: boolean }> {
  const entries = await mapLimit(
    candidates.map((outfit, index) => ({ outfit, index })),
    MAX_CONCURRENT_JEV,
    async ({ outfit, index }) => {
      if (Date.now() - ctx.startedAt >= RANK_BUDGET_MS) return { outfit, index, score: null };
      const state = ratingState(ctx.profile, { occasion: ctx.occasion, weather: ctx.weather, season: ctx.rules.season }, outfit);
      return { outfit, index, score: (await jevRating(ctx.env, ctx.fetch, state, ctx.rand))?.score ?? null };
    },
  );
  const rated = entries
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const unrated = entries.filter((entry) => entry.score === null);
  const ranked = [...rated, ...unrated].map(({ outfit, score }) => ({
    garmentIds: outfit.map((garment) => garment.id),
    score,
    freshThisWeek: !wornThisWeek(outfit, ctx.rules.today),
  }));
  return { ranked, complete: unrated.length === 0 };
}

/** The slot a garment's ranking cap is counted in: a one-piece shares the top's (they are alternatives). */
function capSlotOf(garment: RuleGarment): Slot | null {
  if (garment.category === null) return null;
  const slot = slotOf(garment.category);
  return slot === 'one_piece' ? 'top' : slot;
}

/**
 * The `MAX_RANKED` candidates Jev rates: the best by pre-score (ties in generation order), with at
 * most `MAX_PER_BASE` per base. A first pass also caps how many of them each base garment is in,
 * per slot: `max(MAX_PER_PIECE, ceil(MAX_RANKED / distinct garments of that slot among the
 * candidates))`. Tops and one-pieces are counted together, since either one dresses the body: a
 * lone top beside several dresses is not unavoidable. The few freshest pieces can't fill the
 * whole list, while a garment with no alternative (the one coat on a cold day, the one pair of
 * shoes) is never capped. A second pass fills what's left without that cap. Returned in
 * pre-score order. Exported for tests and probes.
 */
export function selectForRanking(candidates: readonly Outfit[], date: string): Outfit[] {
  const sorted = candidates
    .map((outfit, index) => ({ outfit, index, pre: preScore(outfit, date), base: basePieces(outfit) }))
    .sort((a, b) => b.pre - a.pre || a.index - b.index);
  const garmentsPerSlot = new Map<Slot, Set<string>>();
  for (const { base } of sorted) {
    for (const garment of base) {
      const slot = capSlotOf(garment);
      if (slot === null) continue;
      garmentsPerSlot.set(slot, (garmentsPerSlot.get(slot) ?? new Set<string>()).add(garment.id));
    }
  }
  const capOf = (garment: RuleGarment): number => {
    const slot = capSlotOf(garment);
    const distinct = slot === null ? 1 : (garmentsPerSlot.get(slot)?.size ?? 1);
    return Math.max(MAX_PER_PIECE, Math.ceil(MAX_RANKED / distinct));
  };

  const perBase = new Map<string, number>();
  const perPiece = new Map<string, number>();
  const chosen = new Set<number>();
  for (const capPieces of [true, false]) {
    for (const { base, index } of sorted) {
      if (chosen.size >= MAX_RANKED) break;
      if (chosen.has(index)) continue;
      const baseKey = base
        .map((garment) => garment.id)
        .sort()
        .join(',');
      if ((perBase.get(baseKey) ?? 0) >= MAX_PER_BASE) continue;
      if (capPieces && base.some((garment) => (perPiece.get(garment.id) ?? 0) >= capOf(garment))) continue;
      chosen.add(index);
      perBase.set(baseKey, (perBase.get(baseKey) ?? 0) + 1);
      for (const garment of base) perPiece.set(garment.id, (perPiece.get(garment.id) ?? 0) + 1);
    }
  }
  return sorted.filter(({ index }) => chosen.has(index)).map(({ outfit }) => outfit);
}

/** The cached list without the internal `degraded` marker. */
function withoutMarker(result: CachedLucky): OkResponse {
  return { kind: result.kind, weather: result.weather, outfits: result.outfits };
}

export async function handleLucky(request: Request, deps: LuckyDeps): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  if (auth === null || userId === null) return reply('invalid', 401, { error: 'unauthorized' });
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, profile] = await Promise.all([loadGarments(env, fetchFn, auth), loadProfile(env, fetchFn, auth)]);
    // Fetched before the size check: the Today screen shows the weather even for a small closet.
    const { weather, lat } = await getLocalWeather(env, fetchFn, {
      city_name: profile?.city_name ?? null,
      city_lat: profile?.city_lat ?? null,
      city_lon: profile?.city_lon ?? null,
    });

    const missing = missingSlots(garments);
    if (missing.length > 0) return reply('too_small', 200, { kind: 'too_small', missing, weather } satisfies LuckyResponse);

    const key = await cacheKey(garments, profile, input);
    const closet = new Map(garments.map((garment) => [garment.id, garment]));
    const hit = fromCache(await cacheGet(env, fetchFn, 'lucky_cache', userId, key), closet, input.date, weather);
    if (hit !== null) return reply('cached', 200, hit);

    if (!(await consumeQuota(env, fetchFn, userId, 'lucky', LUCKY_DAILY_LIMIT))) {
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    // `generateCandidates` sets `outerwearAvailable` from the closet itself (ruling P4-R7).
    const rules: RuleContext = { occasion: input.occasion, season: seasonOf(input.date, lat), weather, today: input.date };
    const candidates = selectForRanking(generateCandidates(garments, rules, userId + input.date), input.date);
    const { ranked, complete } = await rank(
      { env, fetch: fetchFn, rand: deps.rand ?? Math.random, profile, occasion: input.occasion, weather, rules, startedAt },
      candidates,
    );
    // A location that resolved to coordinates but got no forecast is a transient failure; no city
    // (or one that can't be geocoded) is not, and recomputing it hourly would only spend quota.
    // NOTE: a geocode that times out for a typed city (no stored coordinates) looks like a city
    // that can't be geocoded, so its weather-null list is cached for the day. Upgrade path: have
    // `getLocalWeather` report why the weather is null (none, unknown city, upstream failure).
    const weatherFailed = weather === null && lat !== null && locationOf(profile) !== null;
    const result: CachedLucky = { kind: 'ok', weather, outfits: ranked, degraded: !complete || weatherFailed };

    await cachePut(env, fetchFn, 'lucky_cache', userId, key, result);
    const outcome: Outcome = result.degraded ? 'degraded' : ranked.length === 0 ? 'empty' : 'ranked';
    return reply(outcome, 200, withoutMarker(result));
  } catch {
    // The database itself failed (garments, profile or quota); nothing was ranked or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
