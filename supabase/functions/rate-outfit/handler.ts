// Rates a picked outfit with Jev (Claude fallback) and suggests a swap: docs/ai.md#the-rate-outfit-function.
// Logs carry only an outcome word, never garments, the profile, prompts or model output.

import {
  MAX_OUTFIT_PIECES,
  MIN_OUTFIT_PIECES,
  OCCASIONS,
  type Occasion,
  type Season,
  type Slot,
  slotOf,
} from '../_shared/catalog.ts';
import type { FnEnv } from '../_shared/env.ts';
import { buildFallbackRequest, parseFallback } from '../_shared/fallbackRater.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { callerOf, readJson, reply } from '../_shared/http.ts';
import {
  garmentFingerprint,
  isCompleteOutfit,
  passesRules,
  preScore,
  type RuleContext,
  type RuleGarment,
  seasonOf,
} from '../_shared/outfitRules.ts';
import { pickReasons, RATING_CONFIG, RATING_LEVELS, type RatingLabel, type RatingReason } from '../_shared/rating.ts';
import {
  cacheGet,
  cachePut,
  type ComposedRating,
  composeAnswers,
  consumeQuota,
  getLocalWeather,
  isIsoDate,
  jevRating,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  runClaude,
  sha256Hex,
  profileIdentity,
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

/** The result plus the internal `degraded` marker (a Claude estimate, or a skipped or failed swap search), stripped before answering. */
type CachedRating = RatingResult & { degraded: boolean };

type Outcome = 'cached' | 'rated' | 'fallback' | 'over_quota' | 'unavailable' | 'invalid' | 'error';

export const RATING_DAILY_LIMIT = 50;
export const MAX_SWAP_CANDIDATES = 8;
/** No swap rating starts this long after the request arrived, so the answer beats the app's deadline. */
export const SWAP_BUDGET_MS = 15_000;
const CACHE_VERSION = 2;

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
  season: Season | null;
  date: string;
  startedAt: number;
};

type SwapOutcome = Pick<RatingResult, 'swap' | 'noBetterSwap'> & { degraded: boolean };

/** A swap search that was skipped or failed: nothing is known, so neither a swap nor "no better swap". */
const UNKNOWN_SWAP: SwapOutcome = { swap: null, noBetterSwap: false, degraded: true };

async function readInput(request: Request): Promise<RateInput | null> {
  const body = await readJson(request);
  if (!isRecord(body)) return null;
  const { garment_ids: ids, occasion, date } = body;
  if (!Array.isArray(ids) || ids.length < MIN_OUTFIT_PIECES || ids.length > MAX_OUTFIT_PIECES) return null;
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

/** The cache key; `profileIdentity`, so a language toggle keeps the entry. */
function cacheKey(outfit: readonly RuleGarment[], ctx: RatingContext): Promise<string> {
  const items = [...outfit]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => [...garmentFingerprint(g), g.status]);
  return sha256Hex(
    JSON.stringify({
      v: CACHE_VERSION,
      items,
      profile: profileIdentity(ctx.profile),
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

const overBudget = (ctx: RatingContext): boolean => Date.now() - ctx.startedAt >= SWAP_BUDGET_MS;

/**
 * The best swap for the weakest piece (docs/ai.md#swaps): Jev-rated only, offered when it beats
 * `current` by `swapMinGain`. A search cut short by `SWAP_BUDGET_MS` offers a qualifying swap it
 * already found, else `UNKNOWN_SWAP`; either way it's cached as degraded.
 */
async function findSwap(
  ctx: RatingContext,
  outfit: readonly RuleGarment[],
  weakestSlot: Slot,
  current: number,
): Promise<SwapOutcome> {
  // NOTE: Jev names a slot, not a piece, so a two-accessory slot swaps the first; upgrade: ask Jev for an index.
  const from = outfit.find((garment) => slotOfGarment(garment) === weakestSlot);
  if (from === undefined) return { swap: null, noBetterSwap: false, degraded: false };
  if (overBudget(ctx)) return UNKNOWN_SWAP;

  let closet: RuleGarment[];
  try {
    closet = await loadGarments(ctx.env, ctx.fetch, ctx.auth);
  } catch {
    return UNKNOWN_SWAP;
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
        garment.suggest &&
        !inOutfit.has(garment.id) &&
        slotOfGarment(garment) === weakestSlot &&
        passesRules([garment], rules),
    )
    .map((garment) => ({ garment, freshness: preScore([garment], ctx.date) }))
    .sort((a, b) => b.freshness - a.freshness || (a.garment.id < b.garment.id ? -1 : 1))
    .slice(0, MAX_SWAP_CANDIDATES)
    .map(({ garment }) => garment);
  if (candidates.length === 0) return { swap: null, noBetterSwap: true, degraded: false };

  const rated = await mapLimit(candidates, MAX_CONCURRENT_JEV, async (candidate) => {
    if (overBudget(ctx)) return 'skipped' as const;
    const variant = outfit.map((garment) => (garment === from ? candidate : garment));
    const rating = await jevRating(ctx.env, ctx.fetch, stateFor(ctx, variant), ctx.rand);
    return rating === null ? null : { toId: candidate.id, score: rating.score };
  });
  const skipped = rated.includes('skipped');
  const scored = rated.filter((entry) => entry !== null && entry !== 'skipped');
  // Every candidate's rating failed: nothing is known about them, so don't claim none is better.
  if (scored.length === 0) return UNKNOWN_SWAP;
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score - current < RATING_CONFIG.swapMinGain) {
    // A cut-short search can't claim the unrated candidates are no better.
    return skipped ? UNKNOWN_SWAP : { swap: null, noBetterSwap: true, degraded: false };
  }
  return { swap: { fromId: from.id, toId: best.toId, score: best.score }, noBetterSwap: false, degraded: skipped };
}

function resultFrom(
  rating: ComposedRating,
  estimated: boolean,
  outfit: readonly RuleGarment[],
  slots: ReadonlySet<Slot>,
): CachedRating {
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
    degraded: estimated,
  };
}

/** The cached value without the internal `degraded` marker. */
function withoutMarker(cached: unknown): unknown {
  if (!isRecord(cached)) return cached;
  return Object.fromEntries(Object.entries(cached).filter(([field]) => field !== 'degraded'));
}

/** A cached swap's garment may be gone or put away since: re-read it and drop the swap (cache untouched) unless available. */
async function recheckSwap(ctx: RatingContext, cached: unknown): Promise<unknown> {
  if (!isRecord(cached) || !isRecord(cached.swap)) return cached;
  const { toId } = cached.swap;
  let available = false;
  if (typeof toId === 'string' && UUID.test(toId)) {
    try {
      const [target] = await loadGarments(ctx.env, ctx.fetch, ctx.auth, [toId]);
      available = target?.status === 'available';
    } catch {
      available = false;
    }
  }
  return available ? cached : { ...cached, swap: null, noBetterSwap: false };
}

async function rate(
  ctx: RatingContext,
  userId: string,
  outfit: readonly RuleGarment[],
): Promise<{ outcome: Outcome; status: number; body: unknown }> {
  const key = await cacheKey(outfit, ctx);
  const cached = await cacheGet(ctx.env, ctx.fetch, 'rating_cache', userId, key);
  if (cached !== null) return { outcome: 'cached', status: 200, body: await recheckSwap(ctx, withoutMarker(cached)) };

  if (!(await consumeQuota(ctx.env, ctx.fetch, userId, 'rating', RATING_DAILY_LIMIT, ctx.date))) {
    return { outcome: 'over_quota', status: 429, body: { error: 'over_quota' } };
  }

  const slots = new Set(outfit.flatMap((garment) => slotOfGarment(garment) ?? []));
  const state = stateFor(ctx, outfit);
  let result: CachedRating;
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
  return { outcome, status: 200, body: withoutMarker(result) };
}

export async function handleRate(request: Request, deps: RateDeps): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
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
      startedAt,
    };
    const { outcome, status, body } = await rate(ctx, userId, outfit);
    return reply(outcome, status, body);
  } catch {
    // The database itself failed (garments, profile or quota); nothing was rated or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
