// The outfit data layer's writes: logging a wear (idempotent per client-generated `wearId`, so a
// retried request never logs it twice) and saving a built outfit. Both go through `rpc`, with
// errors mapped through `requestResult.ts` the same way `garmentRepository.ts`'s writes are.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Database } from '../lib/database.types';
import { runRequest, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

type Client = SupabaseClient<Database>;

export type LogWearInput = {
  /** Generated once per tap with expo-crypto's `randomUUID` and reused on retry, so a lost
   * response can't double-log the wear (`log_wear` is idempotent per `p_wear_id`). */
  wearId: string;
  garmentIds: readonly string[];
  wornOn: string;
  occasion: Occasion | null;
  score: number | null;
};

/**
 * `log_wear`'s own refusals (a garment that isn't the caller's own, or gone; too few garments):
 * retrying the same wear can't succeed. Matched by the function's message, since its 42501 would
 * otherwise read like a missing session's "permission denied", which a retry can fix.
 */
const isLogWearRefusal = (error: { message?: string }): boolean => error.message?.startsWith('log_wear') === true;

/** Logs a wear of `input.garmentIds` on `input.wornOn`; retrying with the same `wearId` is safe. */
export function logWear(input: LogWearInput, client: Client = supabase): Promise<RequestResult> {
  return runRequest(
    () =>
      client.rpc('log_wear', {
        p_wear_id: input.wearId,
        p_garment_ids: [...input.garmentIds],
        p_worn_on: input.wornOn,
        ...(input.occasion !== null && { p_occasion: input.occasion }),
        ...(input.score !== null && { p_score: input.score }),
      }),
    undefined,
    isLogWearRefusal,
  );
}

/** Saves the picked garments as a reusable outfit. */
export function saveOutfit(garmentIds: readonly string[], client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.rpc('save_outfit', { p_garment_ids: [...garmentIds] }));
}
