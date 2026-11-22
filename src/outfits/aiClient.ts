// Maps the outfit functions' errors to `AiError` (docs/api.md#how-the-app-maps-errors). An answer of a
// shape this app version doesn't know is `unknown` too, so nothing unchecked is rendered or stored.

import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import { type Occasion, SLOTS } from '../closet/catalog';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { isForYouResponse } from './storedForYou';
import { isLuckyResponse } from './storedLucky';
import type { ForYouResponse, LuckyResponse, RatingResult } from './types';

type Client = SupabaseClient<Database>;

export type AiError = 'network' | 'over_quota' | 'unavailable' | 'incomplete' | 'not_found' | 'unknown';

export type AiOutcome<T> = { ok: true; result: T } | { ok: false; error: AiError };

const STATUS_TO_ERROR: ReadonlyMap<number, AiError> = new Map([
  [404, 'not_found'],
  [422, 'incomplete'],
  [429, 'over_quota'],
  [503, 'unavailable'],
]);

function errorFrom(error: unknown): AiError {
  if (error instanceof FunctionsHttpError) {
    const status = error.context instanceof Response ? error.context.status : undefined;
    return (status !== undefined ? STATUS_TO_ERROR.get(status) : undefined) ?? 'unknown';
  }
  if (error instanceof FunctionsFetchError || error instanceof TypeError) {
    return 'network';
  }
  return 'unknown';
}

const RATING_LABELS: readonly unknown[] = ['great', 'good', 'fair', 'poor'] satisfies RatingResult['label'][];

function isReason(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.tone === 'good' || value.tone === 'warn') &&
    (value.params === undefined || (isRecord(value.params) && Object.values(value.params).every((param) => typeof param === 'string')))
  );
}

function isSwap(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) && typeof value.fromId === 'string' && typeof value.toId === 'string' && typeof value.score === 'number')
  );
}

/** A rating this app version can render. */
export function isRatingResult(value: unknown): value is RatingResult {
  return (
    isRecord(value) &&
    typeof value.score === 'number' &&
    RATING_LABELS.includes(value.label) &&
    (value.confidence === null || typeof value.confidence === 'number') &&
    typeof value.estimated === 'boolean' &&
    Array.isArray(value.reasons) &&
    value.reasons.every(isReason) &&
    (value.weakestSlot === null || (SLOTS as readonly unknown[]).includes(value.weakestSlot)) &&
    isSwap(value.swap) &&
    typeof value.noBetterSwap === 'boolean'
  );
}

/** One function call, its answer checked with `guard`; `trip-plan` (`src/trips/tripClient.ts`) shares it. */
export async function invoke<T>(
  name: 'rate-outfit' | 'lucky-list' | 'for-you' | 'trip-plan',
  body: Record<string, unknown>,
  guard: (value: unknown) => value is T,
  client: Client,
): Promise<AiOutcome<T>> {
  try {
    const response = await client.functions.invoke<unknown>(name, { body });
    if (response.error !== null) return { ok: false, error: errorFrom(response.error) };
    return guard(response.data) ? { ok: true, result: response.data } : { ok: false, error: 'unknown' };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

export function rateOutfit(
  input: { garmentIds: readonly string[]; occasion: Occasion | null; date: string },
  client: Client = supabase,
): Promise<AiOutcome<RatingResult>> {
  return invoke(
    'rate-outfit',
    { garment_ids: input.garmentIds, occasion: input.occasion, date: input.date },
    isRatingResult,
    client,
  );
}

export function fetchLuckyList(
  input: { occasion: Occasion | null; date: string },
  client: Client = supabase,
): Promise<AiOutcome<LuckyResponse>> {
  return invoke('lucky-list', { occasion: input.occasion, date: input.date }, isLuckyResponse, client);
}

/** For you's ideas, with the lines and store-search words in `language` (the app's current locale). */
export function fetchForYou(input: { language: Locale; date: string }, client: Client = supabase): Promise<AiOutcome<ForYouResponse>> {
  return invoke('for-you', { language: input.language, date: input.date }, isForYouResponse, client);
}
