// The day's ranked "feeling lucky" outfits: docs/ai.md#the-lucky-list-function. Logs carry only an
// outcome word, never garments, the profile, prompts or model output.

import { OCCASIONS, type Occasion, type Slot, slotOf } from '../_shared/catalog.ts';
import type { JevEnv, SupabaseEnv, WeatherEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { callerOf, readJson, reply } from '../_shared/http.ts';
import {
  basePieces,
  garmentFingerprint,
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
  getLocalWeather,
  isIsoDate,
  jevRating,
  loadDismissed,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  sha256Hex,
  weatherSummaryFrom,
  profileIdentity,
} from '../_shared/userContext.ts';
import { locationKey, type WeatherSummary } from '../_shared/weather.ts';

export type LuckyEnv = SupabaseEnv & JevEnv & WeatherEnv;

export type LuckyDeps = { env: LuckyEnv; fetch: typeof fetch; rand?: () => number };

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

/** The response plus the internal `degraded` marker (a failed or skipped rating or forecast), stripped before answering. */
type CachedLucky = OkResponse & { degraded: boolean };

type Outcome = 'cached' | 'too_small' | 'ranked' | 'degraded' | 'empty' | 'over_quota' | 'invalid' | 'error';

const LUCKY_DAILY_LIMIT = 10;
const MAX_RANKED = 30;
/** Ranked outfits sharing one base (the same pieces but the extra). */
const MAX_PER_BASE = 2;
/** The floor of the per-garment cap (raised for a slot with few garments; see `selectForRanking`). */
const MAX_PER_PIECE = 4;
/** No Jev call starts this long after the request arrived, so the answer beats the app's deadline. */
const RANK_BUDGET_MS = 15_000;
const CACHE_VERSION = 3;

type LuckyInput = { date: string; occasion: Occasion | null };

async function readInput(request: Request): Promise<LuckyInput | null> {
  const body = await readJson(request);
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
 * Wearing an outfit doesn't change the key (`freshThisWeek` is recomputed on a hit instead). It
 * carries whether `pinned_on` equals *this request's* date, not the raw value: "Wear it" pins for
 * tomorrow and must not re-rank (and spend quota on) today's list. "Not for me" (a dismissed
 * combination, an unsuggested piece) does change it.
 */
function cacheKey(
  garments: readonly RuleGarment[],
  profile: ProfileRow | null,
  input: LuckyInput,
  dismissed: ReadonlySet<string>,
): Promise<string> {
  // Only garments that can be candidates count (not uncategorized, in the laundry or lent).
  const fingerprint = garments
    .filter((g) => g.category !== null && g.status === 'available')
    .sort(byId)
    .map((g) => [...garmentFingerprint(g), g.status, g.pinned_on === input.date, g.suggest]);
  return sha256Hex(
    JSON.stringify({
      v: CACHE_VERSION,
      date: input.date,
      occasion: input.occasion,
      location: locationOf(profile),
      fingerprint,
      dismissed: [...dismissed].sort(),
      profile: profileIdentity(profile),
    }),
  );
}

/** The app's outfit identity: the garment ids sorted and joined, as `dismissed_outfits` stores them. */
const outfitKey = (outfit: Outfit): string =>
  outfit
    .map((g) => g.id)
    .sort()
    .join(',');

/** Garments pinned for the request's date that `generateCandidates` can place (available, categorized). */
function pinnedFor(garments: readonly RuleGarment[], date: string): RuleGarment[] {
  return garments.filter((g) => g.category !== null && g.status === 'available' && g.pinned_on === date);
}

/** Candidates containing any of `pinned` when one does; otherwise all, rather than an empty list. */
function keepPinned(candidates: readonly Outfit[], pinned: readonly RuleGarment[]): Outfit[] {
  if (pinned.length === 0) return [...candidates];
  const pinnedIds = new Set(pinned.map((g) => g.id));
  const withPin = candidates.filter((outfit) => outfit.some((item) => pinnedIds.has(item.id)));
  return withPin.length > 0 ? withPin : [...candidates];
}

/**
 * A cached list, still as ranked, with `freshThisWeek` from current wear dates and this request's
 * weather (else the validated stored one). Null (a miss) when not a well-formed list of this closet.
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
  env: JevEnv;
  fetch: typeof fetch;
  rand: () => number;
  profile: ProfileRow | null;
  occasion: Occasion | null;
  weather: WeatherSummary | null;
  rules: RuleContext;
  startedAt: number;
};

/** Rated by score first, then the rest in pre-score order; `complete` is false when any rating failed or was skipped. */
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
 * The `MAX_RANKED` candidates Jev rates, in pre-score order (ties in generation order), spread by
 * the per-base and per-garment caps of docs/ai.md#the-lucky-list-function (step 5).
 */
function selectForRanking(candidates: readonly Outfit[], date: string): Outfit[] {
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
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, profile, dismissed] = await Promise.all([
      loadGarments(env, fetchFn, auth),
      loadProfile(env, fetchFn, auth),
      loadDismissed(env, fetchFn, auth),
    ]);
    // Fetched before the size check: the Today screen shows the weather even for a small closet.
    const { weather, lat } = await getLocalWeather(env, fetchFn, {
      city_name: profile?.city_name ?? null,
      city_lat: profile?.city_lat ?? null,
      city_lon: profile?.city_lon ?? null,
    });

    const missing = missingSlots(garments);
    if (missing.length > 0) return reply('too_small', 200, { kind: 'too_small', missing, weather } satisfies LuckyResponse);

    const key = await cacheKey(garments, profile, input, dismissed);
    const closet = new Map(garments.map((garment) => [garment.id, garment]));
    const hit = fromCache(await cacheGet(env, fetchFn, 'lucky_cache', userId, key), closet, input.date, weather);
    if (hit !== null) return reply('cached', 200, hit);

    if (!(await consumeQuota(env, fetchFn, userId, 'lucky', LUCKY_DAILY_LIMIT, input.date))) {
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    const rules: RuleContext = { occasion: input.occasion, season: seasonOf(input.date, lat), weather, today: input.date };
    // An unsuggested piece still fills its slot for `missingSlots` above, but joins no candidate.
    const suggestable = garments.filter((g) => g.suggest);
    const pinned = pinnedFor(suggestable, input.date);
    const generated = generateCandidates(
      suggestable,
      rules,
      userId + input.date,
      undefined,
      pinned.map((g) => g.id),
    ).filter((outfit) => !dismissed.has(outfitKey(outfit)));
    const candidates = selectForRanking(keepPinned(generated, pinned), input.date);
    const { ranked, complete } = await rank(
      { env, fetch: fetchFn, rand: deps.rand ?? Math.random, profile, occasion: input.occasion, weather, rules, startedAt },
      candidates,
    );
    // Only a located city with no forecast is transient; recomputing an ungeocodable one hourly wastes quota.
    // NOTE: a timed-out geocode looks ungeocodable, so its list is cached all day; upgrade: `getLocalWeather` reports why.
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
