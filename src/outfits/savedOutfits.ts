import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../lib/database.types';
import { runRequest, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

type Client = SupabaseClient<Database>;

export type SavedOutfit = { id: string; savedAt: string; score: number | null; garmentIds: string[] };

type SavedRow = { id: string; saved_at: string; score: number | null; outfit_items: { garment_id: string }[] };

// NOTE: past 200 saved outfits the oldest don't list; upgrade path: page by `saved_at` once someone keeps that many.
/** The most saved outfits one read lists, newest first. */
export const SAVED_LIMIT = 200;

/** The caller's saved outfits (RLS: own rows), newest first; throws on failure. */
export async function listSavedOutfits(client: Client = supabase): Promise<SavedOutfit[]> {
  const { data, error } = await client
    .from('outfits')
    .select('id, saved_at, score, outfit_items(garment_id)')
    .not('saved_at', 'is', null)
    .order('saved_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SAVED_LIMIT);
  if (error !== null) {
    throw error;
  }
  return (data as SavedRow[]).map((row) => ({
    id: row.id,
    savedAt: row.saved_at,
    score: row.score,
    garmentIds: row.outfit_items.map((item) => item.garment_id),
  }));
}

const reachedRow = ({ data }: { data?: unknown }): boolean => Array.isArray(data) && data.length > 0;

/** Its items cascade; a worn or foreign outfit matches no row (docs/database.md), which is an error. */
export function deleteSavedOutfit(id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('outfits').delete().eq('id', id).select('id'), reachedRow);
}
