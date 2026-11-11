// The outfit AI client: thin wrappers over `supabase.functions.invoke('rate-outfit' | 'lucky-list' |
// 'for-you')` that map the functions' HTTP error bodies (see `supabase/functions/*/handler.ts`)
// onto a small translated-error union the UI renders through i18n, instead of leaking HTTP
// status codes or Supabase's error classes into the screens.

import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
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

async function invoke<T>(
  name: 'rate-outfit' | 'lucky-list' | 'for-you',
  body: Record<string, unknown>,
  client: Client,
): Promise<AiOutcome<T>> {
  try {
    const response = await client.functions.invoke<T>(name, { body });
    if (response.error !== null || response.data === null) {
      return { ok: false, error: response.error !== null ? errorFrom(response.error) : 'unknown' };
    }
    return { ok: true, result: response.data };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

export function rateOutfit(
  input: { garmentIds: readonly string[]; occasion: Occasion | null; date: string },
  client: Client = supabase,
): Promise<AiOutcome<RatingResult>> {
  return invoke<RatingResult>(
    'rate-outfit',
    { garment_ids: input.garmentIds, occasion: input.occasion, date: input.date },
    client,
  );
}

export function fetchLuckyList(
  input: { occasion: Occasion | null; date: string },
  client: Client = supabase,
): Promise<AiOutcome<LuckyResponse>> {
  return invoke<LuckyResponse>('lucky-list', { occasion: input.occasion, date: input.date }, client);
}

/** For you's ideas, with the lines and store-search words in `language` (the app's current locale). */
export function fetchForYou(input: { language: Locale }, client: Client = supabase): Promise<AiOutcome<ForYouResponse>> {
  return invoke<ForYouResponse>('for-you', { language: input.language }, client);
}

/** The device's local calendar day as `YYYY-MM-DD`, matching the functions' `isIsoDate` input. */
export function localDate(now: Date = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
