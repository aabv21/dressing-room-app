// 3–5 "what you're missing" ideas: docs/ai.md#the-for-you-function. Logs carry only an outcome
// word, never garments, the profile, ideas, prompts or model output.

import {
  type ClothingType,
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  type GarmentCategory,
  type GarmentColor,
  type Season,
} from '../_shared/catalog.ts';
import type { ClaudeEnv, GeocodingEnv, JevEnv, SupabaseEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import {
  buildFitRequest,
  buildLinesRequest,
  fitCandidates,
  finalRank,
  type ForYouIdea,
  ownsArchetype,
  parseFit,
  parseLines,
  rankByGain,
  type RankedIdea,
  searchQuery,
  templateLine,
} from '../_shared/forYou.ts';
import { callerOf, readJson, reply as replyWith } from '../_shared/http.ts';
import { garmentFingerprint, type RuleGarment, seasonOf } from '../_shared/outfitRules.ts';
import type { Language } from '../_shared/searchTerms.ts';
import {
  cacheFresh,
  cachePrune,
  cachePut,
  cacheRead,
  cacheReadNewest,
  CLAUDE_TIMEOUT_MS,
  consumeQuota,
  geocodedLatitude,
  isIsoDate,
  loadGarments,
  loadProfile,
  mapLimit,
  MAX_CONCURRENT_JEV,
  type ProfileRow,
  ratingState,
  runClaude,
  runJev,
  sha256Hex,
  profileIdentity,
} from '../_shared/userContext.ts';

type Outcome = 'cached' | 'stale' | 'too_small' | 'ranked' | 'degraded' | 'empty' | 'over_quota' | 'invalid' | 'error';

const reply = (outcome: Outcome, status: number, body: unknown): Response => replyWith(outcome, status, body);

export type ForYouEnv = SupabaseEnv & JevEnv & ClaudeEnv & GeocodingEnv;

export type ForYouDeps = { env: ForYouEnv; fetch: typeof fetch; now?: () => number };

/** One idea card. `line` is Claude's; when it's null the app renders `lineKey` with `lineParams`. */
export type ForYouCard = {
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

/** The response plus the internal `degraded` marker (a failed or skipped fit, or a template line), stripped before answering. */
type CachedForYou = OkResponse & { degraded: boolean };

export const FOR_YOU_DAILY_LIMIT = 1;
/** An older entry is a miss, so the ideas follow the user's taste at least weekly. */
export const FOR_YOU_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Fewer wardrobe garments (categorized, not donated) than this answer `too_small`, with no quota or model call. */
export const MIN_GARMENTS = 3;
/** No Jev fit call starts this long after the request arrived (as lucky-list's). */
export const FIT_BUDGET_MS = 15_000;
/** The lines call's timeout is what's left of this (at most `CLAUDE_TIMEOUT_MS`), inside the app's 45 s deadline. */
export const LINES_DEADLINE_MS = 38_000;
/** With no more than this left before `LINES_DEADLINE_MS`, Claude is skipped and every idea gets its template. */
export const MIN_LINES_TIMEOUT_MS = 2_000;
// Bump whenever the archetypes, the gain rules or the response shape change: it's what invalidates the stored entries.
const CACHE_VERSION = 5;

const LANGUAGES = ['en', 'es'] as const satisfies readonly Language[];

/** The language, and the app's local day when it sends a valid one (older apps send none). */
async function readInput(request: Request): Promise<{ language: Language; date: string | null } | null> {
  const body = await readJson(request);
  if (!isRecord(body)) return null;
  const language = LANGUAGES.find((candidate) => candidate === body.language);
  if (language === undefined) return null;
  return { language, date: isIsoDate(body.date) ? body.date : null };
}

const byId = (a: RuleGarment, b: RuleGarment): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The wardrobe, not today: laundry and lent garments count as available; only donated ones are out (docs/ai.md#gain). */
function wardrobeOf(garments: readonly RuleGarment[]): RuleGarment[] {
  return garments
    .filter((g) => g.status !== 'donated')
    .map((g) => (g.status === 'available' ? g : { ...g, status: 'available' }));
}

/** The cache key (docs/ai.md#the-for-you-function, step 3); the season keeps ideas from lagging a week behind. */
function cacheKey(
  wardrobe: readonly RuleGarment[],
  profile: ProfileRow | null,
  language: Language,
  season: Season | null,
): Promise<string> {
  const fingerprint = wardrobe
    .filter((g) => g.category !== null)
    .sort(byId)
    .map((g) => [...garmentFingerprint(g), g.suggest]);
  return sha256Hex(
    JSON.stringify({ v: CACHE_VERSION, fingerprint, profile: profileIdentity(profile), language, season }),
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
  env: JevEnv;
  fetch: typeof fetch;
  user: ReturnType<typeof ratingState>['user'];
  startedAt: number;
  now: () => number;
};

/** Null fit when the call failed, didn't parse, or never started (`FIT_BUDGET_MS`); `finalRank` floors it. */
function fitAll(ctx: FitContext, candidates: readonly ForYouIdea[]): Promise<(ForYouIdea & { fit: number | null })[]> {
  return mapLimit(candidates, MAX_CONCURRENT_JEV, async (idea) => {
    if (ctx.now() - ctx.startedAt >= FIT_BUDGET_MS) return { ...idea, fit: null };
    return { ...idea, fit: parseFit(await runJev(ctx.env, ctx.fetch, buildFitRequest(idea.archetype, ctx.user))) };
  });
}

/** Lines by archetype id; empty on failure, timeout, nothing parsed, or a `timeoutMs` below `MIN_LINES_TIMEOUT_MS`. */
async function writeLines(
  env: ClaudeEnv,
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

/**
 * A spent quota's answer instead of a 429: this key's expired entry, else the user's newest under
 * any key minus ideas the wardrobe now owns; null when nothing is left.
 * NOTE: another key's entry may show old counts or language until tomorrow; upgrade: store its language, re-render lines.
 */
async function staleAnswer(
  deps: { env: SupabaseEnv; fetch: typeof fetch },
  userId: string,
  sameKey: OkResponse | null,
  wardrobe: readonly RuleGarment[],
): Promise<OkResponse | null> {
  if (sameKey !== null) return sameKey;
  const newest = await cacheReadNewest(deps.env, deps.fetch, 'for_you_cache', userId);
  const stored = newest === null ? null : fromCache(newest.result);
  const ideas = stored?.ideas.filter((idea) => !ownsArchetype(wardrobe, idea)) ?? [];
  return ideas.length === 0 ? null : { kind: 'ok', ideas };
}

/** Writes the new entry, then (only once it's written) drops the user's other keys, best effort. */
async function store(
  deps: { env: SupabaseEnv; fetch: typeof fetch },
  userId: string,
  key: string,
  result: CachedForYou,
  now: number,
): Promise<void> {
  if (await cachePut(deps.env, deps.fetch, 'for_you_cache', userId, key, result, now)) {
    await cachePrune(deps.env, deps.fetch, 'for_you_cache', userId, key);
  }
}

export async function handleForYou(request: Request, deps: ForYouDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const { auth, userId } = caller;
  const input = await readInput(request);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });
  const { language } = input;
  const day = input.date ?? new Date(startedAt).toISOString().slice(0, 10);

  const { env, fetch: fetchFn } = deps;
  try {
    const [garments, profile] = await Promise.all([loadGarments(env, fetchFn, auth), loadProfile(env, fetchFn, auth)]);

    const wardrobe = wardrobeOf(garments);
    // An uncategorized garment (still being read) can't combine.
    if (wardrobe.filter((g) => g.category !== null).length < MIN_GARMENTS) {
      return reply('too_small', 200, { kind: 'too_small' } satisfies ForYouResponse);
    }

    // A city typed without coordinates is geocoded for its latitude, so a temperate city keeps its season.
    const cityName = profile?.city_name ?? null;
    const lat = profile?.city_lat ?? (cityName === null ? null : await geocodedLatitude(env, fetchFn, cityName));
    const season = seasonOf(day, lat);
    const key = await cacheKey(wardrobe, profile, language, season);
    const row = await cacheRead(env, fetchFn, 'for_you_cache', userId, key);
    const stored = row === null ? null : fromCache(row.result);
    if (row !== null && stored !== null && cacheFresh(row, now(), FOR_YOU_TTL_MS)) return reply('cached', 200, stored);

    if (!(await consumeQuota(env, fetchFn, userId, 'for_you', FOR_YOU_DAILY_LIMIT, day))) {
      const stale = await staleAnswer(deps, userId, stored, wardrobe);
      if (stale !== null) return reply('stale', 200, stale);
      return reply('over_quota', 429, { error: 'over_quota' });
    }

    const clothingType = profile?.clothing_type ?? 'everything';
    const ranked = rankByGain(wardrobe, clothingType, season);
    if (ranked.length === 0) {
      const empty: CachedForYou = { kind: 'ok', ideas: [], degraded: false };
      await store(deps, userId, key, empty, now());
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
    await store(deps, userId, key, result, now());
    return reply(degraded ? 'degraded' : 'ranked', 200, withoutMarker(result));
  } catch {
    // The database itself failed (garments, profile or quota); nothing was ranked or cached.
    return reply('error', 500, { error: 'internal' });
  }
}
