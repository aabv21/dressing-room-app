// `trip-plan`'s call (docs/api.md#trip-plan): the answer checked with `isTripResponse`, errors mapped like
// the outfit functions' (`AiError`).
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { invoke, type AiOutcome } from '../outfits/aiClient';
import { isTripResponse, type TripResponse } from './tripResponse';

export { isTripResponse };
export type { PackingGroup, TripDay, TripResponse } from './tripResponse';

type Client = SupabaseClient<Database>;

export type TripInput = { city: string; start: string; end: string; occasion: Occasion | null; language: Locale; date: string };

export function planTripRequest(input: TripInput, client: Client = supabase): Promise<AiOutcome<TripResponse>> {
  return invoke(
    'trip-plan',
    { city: input.city, start: input.start, end: input.end, occasion: input.occasion, language: input.language, date: input.date },
    isTripResponse,
    client,
  );
}
