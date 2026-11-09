// The wears data layer: the signed-in user's logged wears (RLS limits it to their own) joined to
// the garments worn, and deleting a logged wear (Diary's "Delete").

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Database } from '../lib/database.types';
import { runRequest, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

type Client = SupabaseClient<Database>;

export type WearWithItems = {
  id: string;
  wornOn: string;
  occasion: Occasion | null;
  score: number | null;
  garmentIds: string[];
};

type WearRow = {
  id: string;
  worn_on: string;
  occasion: Occasion | null;
  score: number | null;
  outfits: { outfit_items: { garment_id: string }[] } | null;
};

/** The signed-in user's wears (and their outfit's garment ids) with `worn_on` in `[from, to]`, newest first. */
export async function listWears(from: string, to: string, client: Client = supabase): Promise<WearWithItems[]> {
  const { data, error } = await client
    .from('wears')
    .select('id, worn_on, occasion, score, outfit_id, outfits(outfit_items(garment_id))')
    .gte('worn_on', from)
    .lte('worn_on', to)
    .order('worn_on', { ascending: false });
  if (error !== null) {
    throw error;
  }
  return (data as WearRow[]).map((row) => ({
    id: row.id,
    wornOn: row.worn_on,
    occasion: row.occasion,
    score: row.score,
    garmentIds: (row.outfits?.outfit_items ?? []).map((item) => item.garment_id),
  }));
}

const reachedRow = ({ data }: { data?: unknown }): boolean => Array.isArray(data) && data.length > 0;

/** Deletes a logged wear; the trigger that lowers the garments' wear counts runs on the row's removal. */
export function deleteWear(id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('wears').delete().eq('id', id).select('id'), reachedRow);
}
