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
// NOTE: past 20,000 wears a range loses its oldest, and a hosted `max_rows` below the page size stops
// after one page; upgrade path: page by `worn_on` instead of offset, until a page comes back empty.
/** At most this many pages per call (20,000 wears, far above a year of daily outfits). */
export const WEARS_MAX_PAGES = 20;

/** Wears with `worn_on` in `[from, to]`, newest first, paged until one comes back short; throws on failure. */
export async function listWears(from: string, to: string, client: Client = supabase): Promise<WearWithItems[]> {
  // By id: a wear logged or deleted between two page reads shifts the pages, and a row can come back
  // twice; a repeat is kept once (a row skipped that way is the offset paging's known limit).
  const rows = new Map<string, WearRow>();
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
    for (const row of pageRows) rows.set(row.id, row);
    if (pageRows.length < WEARS_PAGE_SIZE) {
      break;
    }
  }
  return [...rows.values()].map((row) => ({
    id: row.id,
    wornOn: row.worn_on,
    occasion: row.occasion,
    score: row.score,
    garmentIds: (row.outfits?.outfit_items ?? []).map((item) => item.garment_id),
  }));
}

const reachedRow = ({ data }: { data?: unknown }): boolean => Array.isArray(data) && data.length > 0;

/** A trigger lowers the garments' wear counts on removal. */
export function deleteWear(id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('wears').delete().eq('id', id).select('id'), reachedRow);
}
