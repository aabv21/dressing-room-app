// The `rate-outfit` Edge Function's request handler: rates the outfit a signed-in user picked
// (2–6 of their garments) with Jev, falls back to Claude when Jev fails, and suggests a swap for
// the weakest piece when the score is low. Runtime-neutral: every effect goes through the
// injected `fetch`, so Jest drives it under Node and `index.ts` serves it under Deno.
//
// Garments and the profile are read with the caller's own token (RLS applies, so a foreign id
// looks deleted); the quota, the caches and the weather cache use the service role. Logs carry
// only an outcome word, never garments, the profile, prompts or model output. See `docs/ai.md`'s
// "Outfit rating".

import { OCCASIONS, type Occasion, type Season, type Slot, slotOf } from '../_shared/catalog.ts';
import { isRecord } from '../_shared/extraction.ts';
import { buildFallbackRequest, parseFallback } from '../_shared/fallbackRater.ts';
import { isCompleteOutfit, passesRules, preScore, type RuleContext, type RuleGarment, seasonOf } from '../_shared/outfitRules.ts';
import { pickReasons, RATING_CONFIG, RATING_LEVELS, type RatingLabel, type RatingReason } from '../_shared/rating.ts';
import {
  cacheGet,
  cachePut,
  type ComposedRating,
  composeAnswers,
  consumeQuota,
  type FnEnv,
  getLocalWeather,
  jevRating,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  runClaude,
  sha256Hex,
  userIdFromJwt,
  UUID,
} from '../_shared/userContext.ts';
import type { WeatherSummary } from '../_shared/weather.ts';

export type RateDeps = { env: FnEnv; fetch: typeof fetch; rand?: () => number };

export type RatingResult = {
  score: number;
  label: RatingLabel;
  /** Jev's weighted confidence, 0..100; null for a Claude-estimated rating. */
  confidence: number | null;
  estimated: boolean;
  reasons: RatingReason[];
  weakestSlot: Slot | null;
  swap: { fromId: string; toId: string; score: number } | null;
  /** True when a swap was looked for and none beat the score by `RATING_CONFIG.swapMinGain`. */
  noBetterSwap: boolean;
};

type Outcome = 'cached' | 'rated' | 'fallback' | 'over_quota' | 'unavailable' | 'invalid' | 'error';

export const RATING_DAILY_LIMIT = 50;
export const MAX_SWAP_CANDIDATES = 8;
const MIN_GARMENTS = 2;
const MAX_GARMENTS = 6;
const CACHE_VERSION = 1;

type RateInput = { garmentIds: string[]; occasion: Occasion | null; date: string };

/** Everything one rating depends on besides the garments. */
type RatingContext = {
  env: FnEnv;
  fetch: typeof fetch;
  rand: () => number;
  auth: string;
  profile: ProfileRow | null;
  occasion: Occasion | null;
  weather: WeatherSummary | null;
  season: Season;
  date: string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: Outcome, status: number, body: unknown): Response {
  console.info(JSON.stringify({ outcome }));
  return json(status, body);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readInput(request: Request): Promise<RateInput | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const { garment_ids: ids, occasion, date } = body;
  if (!Array.isArray(ids) || ids.length < MIN_GARMENTS || ids.length > MAX_GARMENTS) return null;
  const garmentIds: string[] = [];
  for (const id of ids as unknown[]) {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    garmentIds.push(id.toLowerCase());
  }
  if (new Set(garmentIds).size !== garmentIds.length) return null;
  const knownOccasion = OCCASIONS.find((candidate) => candidate === occasion);
  if (occasion !== null && knownOccasion === undefined) return null;
  if (!isIsoDate(date)) return null;
  return { garmentIds, occasion: knownOccasion ?? null, date };
}

/**
 * The cache key: each garment's rating-relevant columns (not `updated_at`, which logging a wear
 * bumps; ruling P4-R6), the profile version, the occasion, the season and the weather bucket.
 */
function cacheKey(outfit: readonly RuleGarment[], ctx: RatingContext): Promise<string> {
  const items = [...outfit]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth, g.status]);
  return sha256Hex(
    JSON.stringify({
      v: CACHE_VERSION,
      items,
      profile: ctx.profile?.updated_at ?? null,
      occasion: ctx.occasion,
      season: ctx.season,
      weatherBand: ctx.weather?.band ?? null,
      rain: ctx.weather?.rain ?? null,
    }),
  );
}

function stateFor(ctx: RatingContext, outfit: readonly RuleGarment[]) {
  return ratingState(ctx.profile, { occasion: ctx.occasion, weather: ctx.weather, season: ctx.season }, outfit);
}

const slotOfGarment = (garment: RuleGarment): Slot | null => (garment.category === null ? null : slotOf(garment.category));

/**
 * The best swap for the piece in `weakestSlot`: the caller's other available garments in that
 * slot that pass the occasion/season/weather rules on their own (Jev judges the combination),
 * least recently worn first, capped at `MAX_SWAP_CANDIDATES`, each rated with Jev (never the
 * fallback). A swap is offered only when it beats `current` by `swapMinGain`.
 */
async function findSwap(
  ctx: RatingContext,
  outfit: readonly RuleGarment[],
  weakestSlot: Slot,
  current: number,
): Promise<Pick<RatingResult, 'swap' | 'noBetterSwap'>> {
  // NOTE: when the slot holds several pieces (two accessories) the first one is swapped; Jev
  // names a slot, not a piece. Upgrade path: ask Jev to name the piece by index.
  const from = outfit.find((garment) => slotOfGarment(garment) === weakestSlot);
  if (from === undefined) return { swap: null, noBetterSwap: false };

  let closet: RuleGarment[];
  try {
    closet = await loadGarments(ctx.env, ctx.fetch, ctx.auth);
  } catch {
    return { swap: null, noBetterSwap: false };
  }
  const rules: RuleContext = {
    occasion: ctx.occasion,
    season: ctx.season,
    weather: ctx.weather,
    today: ctx.date,
    // The "cold needs outerwear" rule is about whole outfits; each candidate is checked alone.
    outerwearAvailable: false,
  };
  const inOutfit = new Set(outfit.map((garment) => garment.id));
  const candidates = closet
    .filter(
      (garment) =>
        !inOutfit.has(garment.id) && slotOfGarment(garment) === weakestSlot && passesRules([garment], rules),
    )
    .map((garment) => ({ garment, freshness: preScore([garment], ctx.date) }))
    .sort((a, b) => b.freshness - a.freshness || (a.garment.id < b.garment.id ? -1 : 1))
    .slice(0, MAX_SWAP_CANDIDATES)
    .map(({ garment }) => garment);
  if (candidates.length === 0) return { swap: null, noBetterSwap: true };

  const rated = await mapLimit(candidates, MAX_CONCURRENT_JEV, async (candidate) => {
    const variant = outfit.map((garment) => (garment === from ? candidate : garment));
    const rating = await jevRating(ctx.env, ctx.fetch, stateFor(ctx, variant), ctx.rand);
    return rating === null ? null : { toId: candidate.id, score: rating.score };
  });
  const scored = rated.filter((entry) => entry !== null);
  // Every candidate's rating failed: nothing is known about them, so don't claim none is better.
  if (scored.length === 0) return { swap: null, noBetterSwap: false };
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score - current < RATING_CONFIG.swapMinGain) return { swap: null, noBetterSwap: true };
  return { swap: { fromId: from.id, toId: best.toId, score: best.score }, noBetterSwap: false };
}

function resultFrom(
  rating: ComposedRating,
  estimated: boolean,
  outfit: readonly RuleGarment[],
  slots: ReadonlySet<Slot>,
): RatingResult {
  const { weakestSlot } = rating.answers;
  return {
    score: rating.score,
    label: rating.label,
    confidence: estimated ? null : rating.confidence,
    estimated,
    reasons: pickReasons(
      rating.answers.dims,
      outfit.flatMap((garment) => garment.colors),
    ),
    // A slot the outfit doesn't have can't be the weakest piece.
    weakestSlot: weakestSlot !== null && slots.has(weakestSlot) ? weakestSlot : null,
    swap: null,
    noBetterSwap: false,
  };
}

async function rate(
  ctx: RatingContext,
  userId: string,
  outfit: readonly RuleGarment[],
): Promise<{ outcome: Outcome; status: number; body: unknown }> {
  const key = await cacheKey(outfit, ctx);
  const cached = await cacheGet(ctx.env, ctx.fetch, 'rating_cache', userId, key);
  if (cached !== null) return { outcome: 'cached', status: 200, body: cached };

  if (!(await consumeQuota(ctx.env, ctx.fetch, userId, 'rating', RATING_DAILY_LIMIT))) {
    return { outcome: 'over_quota', status: 429, body: { error: 'over_quota' } };
  }

  const slots = new Set(outfit.flatMap((garment) => slotOfGarment(garment) ?? []));
  const state = stateFor(ctx, outfit);
  let result: RatingResult;
  let outcome: Outcome;
  const jev = await jevRating(ctx.env, ctx.fetch, state, ctx.rand);
  if (jev !== null) {
    result = resultFrom(jev, false, outfit, slots);
    outcome = 'rated';
    if (result.score < RATING_CONFIG.swapBelow && result.weakestSlot !== null) {
      result = { ...result, ...(await findSwap(ctx, outfit, result.weakestSlot, result.score)) };
    }
  } else {
    const parsed = parseFallback(await runClaude(ctx.env, ctx.fetch, buildFallbackRequest(state)), RATING_LEVELS);
    if (parsed === null) return { outcome: 'unavailable', status: 503, body: { error: 'rating_unavailable' } };
    // No swap search: Jev just failed, and swaps are rated with Jev only.
    result = resultFrom(composeAnswers(parsed, ctx.weather), true, outfit, slots);
    outcome = 'fallback';
  }

  await cachePut(ctx.env, ctx.fetch, 'rating_cache', userId, key, result);
  return { outcome, status: 200, body: result };
}

export async function handleRate(request: Request, deps: RateDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  if (auth === null || userId === null) return reply('invalid', 401, { error: 'unauthorized' });
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, profile] = await Promise.all([
      loadGarments(env, fetchFn, auth, input.garmentIds),
      loadProfile(env, fetchFn, auth),
    ]);
    const byId = new Map(garments.map((garment) => [garment.id, garment]));
    const outfit = input.garmentIds.flatMap((id) => byId.get(id) ?? []);
    if (outfit.length !== input.garmentIds.length) return reply('invalid', 404, { error: 'garment_not_found' });
    const slots = outfit.map(slotOfGarment);
    if (slots.includes(null) || !isCompleteOutfit(slots.filter((slot) => slot !== null))) {
      return reply('invalid', 422, { error: 'incomplete' });
    }

    const { weather, lat } = await getLocalWeather(env, fetchFn, {
      city_name: profile?.city_name ?? null,
      city_lat: profile?.city_lat ?? null,
      city_lon: profile?.city_lon ?? null,
    });
    const ctx: RatingContext = {
      env,
      fetch: fetchFn,
      rand: deps.rand ?? Math.random,
      auth,
      profile,
      occasion: input.occasion,
      weather,
      season: seasonOf(input.date, lat),
      date: input.date,
    };
    const { outcome, status, body } = await rate(ctx, userId, outfit);
    return reply(outcome, status, body);
  } catch {
    // The database itself failed (garments, profile or quota); nothing was rated or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
