// The `for-you` Edge Function's request handler: 3–5 "what you're missing" ideas for a signed-in
// user. The archetypes the user doesn't own are ranked by how many new outfits each makes with
// the wardrobe, every garment that isn't donated (`rankByGain`); up to 10 of them, spread over
// the slots (`fitCandidates`), get a Jev fit for the user's body and styles; `finalRank` keeps
// the best gain × fit, at most 2 per slot; then one Claude request writes every idea's line, with
// a template key the app renders when a line is missing.
// Runtime-neutral: every effect goes through the injected `fetch`, so Jest drives it under Node
// and `index.ts` serves it under Deno.
//
// Garments and the profile are read with the caller's own token (RLS applies); the quota and
// `for_you_cache` use the service role. Logs carry only an outcome word, never garments, the
// profile, ideas, prompts or model output. See `docs/ai.md`'s "For you".

import {
  type ClothingType,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  type GarmentCategory,
  type GarmentColor,
  type Season,
} from '../_shared/catalog.ts';
import { isRecord } from '../_shared/extraction.ts';
import {
  buildFitRequest,
  buildLinesRequest,
  fitCandidates,
  finalRank,
  type ForYouIdea,
  parseFit,
  parseLines,
  rankByGain,
  type RankedIdea,
  searchQuery,
  templateLine,
} from '../_shared/forYou.ts';
import { type RuleGarment, seasonOf } from '../_shared/outfitRules.ts';
import type { Language } from '../_shared/searchTerms.ts';
import {
  cacheFresh,
  cachePut,
  cacheRead,
  CLAUDE_TIMEOUT_MS,
  consumeQuota,
  type FnEnv,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  runClaude,
  runJev,
  sha256Hex,
  userIdFromJwt,
} from '../_shared/userContext.ts';

export type ForYouDeps = { env: FnEnv; fetch: typeof fetch; now?: () => number };

/** One idea card. `line` is Claude's; when it's null the app renders `lineKey` with `lineParams`. */
export type ForYouCard = {
  /** The archetype id. */
  id: string;
  category: GarmentCategory;
  colors: GarmentColor[];
  newOutfits: number;
  combinesWith: number;
  line: string | null;
  lineKey: string | null;
  lineParams: Record<string, string>;
  /** The store-search words, in the request's language; the app URL-encodes them. */
  searchQuery: string;
};

export type ForYouResponse = { kind: 'too_small' } | { kind: 'ok'; ideas: ForYouCard[] };

type OkResponse = Extract<ForYouResponse, { kind: 'ok' }>;

/**
 * What `for_you_cache` stores: the response plus an internal marker, stripped before answering. A
 * degraded answer (a failed or skipped Jev fit, or a template line where Claude's is missing) is
 * served from the cache for an hour only (ruling P4-R12; see `cacheFresh`).
 */
type CachedForYou = OkResponse & { degraded: boolean };

type Outcome = 'cached' | 'stale' | 'too_small' | 'ranked' | 'degraded' | 'empty' | 'over_quota' | 'invalid' | 'error';

export const FOR_YOU_DAILY_LIMIT = 1;
/** An entry older than this is a miss, so the ideas follow the season and the user's taste at least weekly. */
export const FOR_YOU_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Fewer wardrobe garments (categorized, not donated) than this answer `too_small`, with no quota or model call. */
export const MIN_GARMENTS = 3;
/** No Jev fit call starts once this long has passed since the request arrived (as lucky-list's, P4-R11). */
export const FIT_BUDGET_MS = 15_000;
/**
 * The Claude lines call must finish this long after the request arrived: its timeout is what's left,
 * at most `CLAUDE_TIMEOUT_MS`, so the answer lands well inside the app's 45 s function deadline.
 */
export const LINES_DEADLINE_MS = 38_000;
/** With no more than this left before `LINES_DEADLINE_MS`, Claude is skipped and every idea gets its template. */
export const MIN_LINES_TIMEOUT_MS = 2_000;
// Bump whenever the archetypes, the gain rules or the response shape change: it's what invalidates the stored entries.
const CACHE_VERSION = 2;

const LANGUAGES = ['en', 'es'] as const satisfies readonly Language[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function reply(outcome: Outcome, status: number, body: unknown): Response {
  console.info(JSON.stringify({ outcome }));
  return json(status, body);
}

async function readLanguage(request: Request): Promise<Language | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  return LANGUAGES.find((language) => language === body.language) ?? null;
}

const byId = (a: RuleGarment, b: RuleGarment): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * For you looks at the wardrobe, not at today: a garment in the laundry or lent out is still the
 * user's, so it owns its archetype and combines in the gain like an available one (ruling P5-R9).
 * Only a donated garment is out.
 */
function wardrobeOf(garments: readonly RuleGarment[]): RuleGarment[] {
  return garments
    .filter((g) => g.status !== 'donated')
    .map((g) => (g.status === 'available' ? g : { ...g, status: 'available' }));
}

/**
 * The cache key: the language, the season, `profile.updated_at` (clothing type, body and styles)
 * and a fingerprint of the wardrobe's categorized garments — id and rating-relevant columns, not
 * `status` (the laundry and lending don't change For you), nor `updated_at` or `last_worn_at`,
 * which logging a wear bumps (as lucky-list's, ruling P4-R6). `pinned_on` is the lucky list's
 * business and stays out.
 */
function cacheKey(
  wardrobe: readonly RuleGarment[],
  profile: ProfileRow | null,
  language: Language,
  season: Season,
): Promise<string> {
  const fingerprint = wardrobe
    .filter((g) => g.category !== null)
    .sort(byId)
    .map((g) => [g.id, g.category, g.colors, g.pattern, g.formality, g.fit, g.seasons, g.warmth]);
  return sha256Hex(
    JSON.stringify({ v: CACHE_VERSION, fingerprint, profile: profile?.updated_at ?? null, language, season }),
  );
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
const stringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A stored card, picked field by field; null when it isn't one. */
function cardFrom(value: unknown): ForYouCard | null {
  if (!isRecord(value)) return null;
  const { id, category, colors, newOutfits, combinesWith, line, lineKey, lineParams } = value;
  const knownCategory = GARMENT_CATEGORIES.find((candidate) => candidate === category);
  if (typeof id !== 'string' || knownCategory === undefined || !Array.isArray(colors)) return null;
  const knownColors = (colors as unknown[]).flatMap((color) => GARMENT_COLORS.find((candidate) => candidate === color) ?? []);
  if (knownColors.length !== colors.length || !count(newOutfits) || !count(combinesWith)) return null;
  if (!stringOrNull(line) || !stringOrNull(lineKey) || (line === null) === (lineKey === null)) return null;
  if (!isStringRecord(lineParams) || typeof value.searchQuery !== 'string') return null;
  return {
    id,
    category: knownCategory,
    colors: knownColors,
    newOutfits,
    combinesWith,
    line,
    lineKey,
    lineParams: { ...lineParams },
    searchQuery: value.searchQuery,
  };
}

/** A cached answer without its marker; null (a miss) when the entry isn't a well-formed list of ideas. */
function fromCache(cached: unknown): OkResponse | null {
  if (!isRecord(cached) || cached.kind !== 'ok' || !Array.isArray(cached.ideas)) return null;
  const ideas: ForYouCard[] = [];
  for (const entry of cached.ideas as unknown[]) {
    const card = cardFrom(entry);
    if (card === null) return null;
    ideas.push(card);
  }
  return { kind: 'ok', ideas };
}

type FitContext = {
  env: FnEnv;
  fetch: typeof fetch;
  user: ReturnType<typeof ratingState>['user'];
  startedAt: number;
  now: () => number;
};

/**
 * The candidates with their Jev fit (at most `MAX_CONCURRENT_JEV` calls at once): null when the call
 * failed, its answer didn't parse, or it never started because `FIT_BUDGET_MS` had passed.
 * `finalRank` ranks a null fit at the floor, so the idea keeps its gain.
 */
function fitAll(ctx: FitContext, candidates: readonly ForYouIdea[]): Promise<(ForYouIdea & { fit: number | null })[]> {
  return mapLimit(candidates, MAX_CONCURRENT_JEV, async (idea) => {
    if (ctx.now() - ctx.startedAt >= FIT_BUDGET_MS) return { ...idea, fit: null };
    return { ...idea, fit: parseFit(await runJev(ctx.env, ctx.fetch, buildFitRequest(idea.archetype, ctx.user))) };
  });
}

/**
 * Every idea's Claude line by archetype id; empty when the request failed, timed out or nothing
 * parsed, or when `timeoutMs` is too short to be worth a call (`MIN_LINES_TIMEOUT_MS`).
 */
async function writeLines(
  env: FnEnv,
  fetchFn: typeof fetch,
  ideas: readonly RankedIdea[],
  language: Language,
  timeoutMs: number,
): Promise<Map<string, string>> {
  if (timeoutMs <= MIN_LINES_TIMEOUT_MS) return new Map<string, string>();
  const ids = ideas.map(({ archetype }) => archetype.id);
  const body = await runClaude(env, fetchFn, buildLinesRequest(ideas, language), timeoutMs);
  return parseLines(body, ids) ?? new Map<string, string>();
}

function toCard(idea: RankedIdea, line: string | undefined, clothingType: ClothingType, language: Language): ForYouCard {
  const { archetype, gain } = idea;
  const template = line === undefined ? templateLine(idea) : null;
  return {
    id: archetype.id,
    category: archetype.category,
    colors: [...archetype.colors],
    newOutfits: gain.newOutfits,
    combinesWith: gain.combinesWith,
    line: line ?? null,
    lineKey: template?.key ?? null,
    lineParams: template === null ? {} : { ...template.params },
    searchQuery: searchQuery(archetype, clothingType, language),
  };
}

/** The cached answer without the internal `degraded` marker. */
function withoutMarker(result: CachedForYou): OkResponse {
  return { kind: result.kind, ideas: result.ideas };
}

export async function handleForYou(request: Request, deps: ForYouDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const auth = request.headers.get('authorization');
  const userId = userIdFromJwt(auth);
  if (auth === null || userId === null) return reply('invalid', 401, { error: 'unauthorized' });
  const language = await readLanguage(request);
  if (language === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, profile] = await Promise.all([loadGarments(env, fetchFn, auth), loadProfile(env, fetchFn, auth)]);

    const wardrobe = wardrobeOf(garments);
    // A garment still being read (no category yet) can't combine, so it doesn't count (ruling P5-R11).
    if (wardrobe.filter((g) => g.category !== null).length < MIN_GARMENTS) {
      return reply('too_small', 200, { kind: 'too_small' } satisfies ForYouResponse);
    }

    // NOTE: the season comes from the UTC date and the profile's stored latitude (northern without
    // one): a city typed without coordinates isn't geocoded here, so a southern-hemisphere user who
    // typed one gets northern seasons. Upgrade path: `getLocalWeather`'s geocoded latitude.
    const season = seasonOf(new Date(now()).toISOString().slice(0, 10), profile?.city_lat ?? null);
    const key = await cacheKey(wardrobe, profile, language, season);
    const row = await cacheRead(env, fetchFn, 'for_you_cache', userId, key);
    const stored = row === null ? null : fromCache(row.result);
    if (row !== null && stored !== null && cacheFresh(row, now(), FOR_YOU_TTL_MS)) return reply('cached', 200, stored);

    if (!(await consumeQuota(env, fetchFn, userId, 'for_you', FOR_YOU_DAILY_LIMIT))) {
      // An expired entry for this same closet (a degraded one past its hour, or one over a week
      // old) beats an error: with one miss a day, the retry it was expired for has to wait anyway.
      if (stored !== null) return reply('stale', 200, stored);
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    const clothingType = profile?.clothing_type ?? 'everything';
    const ranked = rankByGain(wardrobe, clothingType, season);
    if (ranked.length === 0) {
      const empty: CachedForYou = { kind: 'ok', ideas: [], degraded: false };
      await cachePut(env, fetchFn, 'for_you_cache', userId, key, empty, now());
      return reply('empty', 200, withoutMarker(empty));
    }

    const candidates = fitCandidates(ranked);
    const user = ratingState(profile, { occasion: null, weather: null, season }, []).user;
    const fitted = await fitAll({ env, fetch: fetchFn, user, startedAt, now }, candidates);
    const ideas = finalRank(fitted);
    const linesTimeout = Math.min(CLAUDE_TIMEOUT_MS, LINES_DEADLINE_MS - (now() - startedAt));
    const lines = await writeLines(env, fetchFn, ideas, language, linesTimeout);
    const cards = ideas.map((idea) => toCard(idea, lines.get(idea.archetype.id), clothingType, language));

    const degraded = fitted.some(({ fit }) => fit === null) || cards.some((card) => card.line === null);
    const result: CachedForYou = { kind: 'ok', ideas: cards, degraded };
    await cachePut(env, fetchFn, 'for_you_cache', userId, key, result, now());
    return reply(degraded ? 'degraded' : 'ranked', 200, withoutMarker(result));
  } catch {
    // The database itself failed (garments, profile or quota); nothing was ranked or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
