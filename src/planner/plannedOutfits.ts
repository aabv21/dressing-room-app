// The planner's data layer: plans read under RLS, written through `plan_outfit` (docs/database.md#planning-an-outfit).
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Database } from '../lib/database.types';
import { runRequest, type RequestError, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

type Client = SupabaseClient<Database>;

/** `garmentIds` may name a garment deleted since: only the pieces still in the closet are shown and worn. */
export type PlannedOutfit = { id: string; day: string; garmentIds: string[]; occasion: Occasion | null };

export type PlanInput = { day: string; garmentIds: readonly string[]; occasion: Occasion | null };

type PlanRow = { id: string; planned_on: string; garment_ids: string[]; occasion: Occasion | null };

/** The caller's plans from `from` to `to` (both included), by day; throws on failure. */
export async function listPlans(from: string, to: string, client: Client = supabase): Promise<PlannedOutfit[]> {
  const { data, error } = await client
    .from('planned_outfits')
    .select('id, planned_on, garment_ids, occasion')
    .gte('planned_on', from)
    .lte('planned_on', to)
    .order('planned_on', { ascending: true });
  if (error !== null) {
    throw error;
  }
  return (data as PlanRow[]).map((row) => ({ id: row.id, day: row.planned_on, garmentIds: row.garment_ids, occasion: row.occasion }));
}

/** `plan_outfit`'s own refusals (a foreign garment, a day out of the window) can't succeed on retry. */
const isPlanRefusal = (error: { message?: string }): boolean => error.message?.startsWith('plan_outfit') === true;

/** Plans `day`, replacing its plan; answers the stored plan. */
export async function planOutfit(
  input: PlanInput,
  client: Client = supabase,
): Promise<{ ok: true; plan: PlannedOutfit } | { ok: false; error: RequestError }> {
  let id: unknown = null;
  const result = await runRequest(
    async () => {
      const response = await client.rpc('plan_outfit', {
        p_planned_on: input.day,
        p_garment_ids: [...input.garmentIds],
        ...(input.occasion !== null && { p_occasion: input.occasion }),
      });
      id = response.data;
      return response;
    },
    () => typeof id === 'string',
    isPlanRefusal,
  );
  if (!result.ok) return result;
  return { ok: true, plan: { id: String(id), day: input.day, garmentIds: [...input.garmentIds], occasion: input.occasion } };
}

/** A plan already gone counts as removed: the user wanted it gone. */
export function removePlan(id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('planned_outfits').delete().eq('id', id));
}
