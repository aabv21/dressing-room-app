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

/** Rows per request: PostgREST's `max_rows`, Supabase's default 1000. */
export const WEARS_PAGE_SIZE = 1000;
/**
 * At most this many pages per call (20,000 wears, far above a year of daily outfits).
 * NOTE: a range holding more wears than that loses its oldest ones, and a hosted `max_rows` below
 * the page size would end the paging after the first page. Upgrade path: page by `worn_on` instead
 * of by offset, until a page comes back empty.
 */
export const WEARS_MAX_PAGES = 20;

/**
 * The signed-in user's wears (and their outfit's garment ids) with `worn_on` in `[from, to]`,
 * newest first (by day, then by when they were logged), read in pages of `WEARS_PAGE_SIZE` until
 * one comes back short. Throws if any page fails.
 */
export async function listWears(from: string, to: string, client: Client = supabase): Promise<WearWithItems[]> {
  const rows: WearRow[] = [];
  for (let page = 0; page < WEARS_MAX_PAGES; page += 1) {
    const start = page * WEARS_PAGE_SIZE;
    const { data, error } = await client
      .from('wears')
      .select('id, worn_on, occasion, score, outfit_id, outfits(outfit_items(garment_id))')
      .gte('worn_on', from)
      .lte('worn_on', to)
      .order('worn_on', { ascending: false })
      // Within a day the latest logged wear comes first (the diary's thumbnail is the latest one's).
      .order('created_at', { ascending: false })
      // A total order, so consecutive pages never repeat or skip a row.
      .order('id', { ascending: false })
      .range(start, start + WEARS_PAGE_SIZE - 1);
    if (error !== null) {
      throw error;
    }
    const pageRows = data as WearRow[];
    rows.push(...pageRows);
    if (pageRows.length < WEARS_PAGE_SIZE) {
      break;
    }
  }
  return rows.map((row) => ({
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
