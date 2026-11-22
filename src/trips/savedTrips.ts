// Saved trips: the `trip-plan` answer kept on the user's Save, read back under RLS (docs/api.md).
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Occasion } from '../closet/catalog';
import type { Database, Json } from '../lib/database.types';
import { runRequest, type RequestError, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';
import { isTripResponse, type TripResponse } from './tripResponse';

type Client = SupabaseClient<Database>;

export type SavedTrip = { id: string; city: string; start: string; end: string; occasion: Occasion | null; result: TripResponse };

export type NewTrip = Omit<SavedTrip, 'id'>;

type TripRow = { id: string; city: string; start_on: string; end_on: string; occasion: Occasion | null; result: unknown };

// NOTE: lists the newest 50; upgrade path: page by `created_at` once someone keeps that many.
export const SAVED_TRIPS_LIMIT = 50;

/** Null for a snapshot this app version can't render (a newer function's). */
function tripFrom(row: TripRow): SavedTrip | null {
  if (!isTripResponse(row.result)) return null;
  return { id: row.id, city: row.city, start: row.start_on, end: row.end_on, occasion: row.occasion, result: row.result };
}

/** Newest first; throws on failure. */
export async function listSavedTrips(client: Client = supabase): Promise<SavedTrip[]> {
  const { data, error } = await client
    .from('saved_trips')
    .select('id, city, start_on, end_on, occasion, result')
    .order('created_at', { ascending: false })
    .limit(SAVED_TRIPS_LIMIT);
  if (error !== null) throw error;
  return (data as TripRow[]).flatMap((row) => tripFrom(row) ?? []);
}

export async function saveTrip(
  trip: NewTrip,
  client: Client = supabase,
): Promise<{ ok: true; trip: SavedTrip } | { ok: false; error: RequestError }> {
  let row: unknown = null;
  const result = await runRequest(
    async () => {
      const response = await client
        .from('saved_trips')
        .insert({ city: trip.city, start_on: trip.start, end_on: trip.end, occasion: trip.occasion, result: trip.result as unknown as NonNullable<Json> })
        .select('id, city, start_on, end_on, occasion, result')
        .single();
      row = response.data;
      return response;
    },
    () => row !== null,
  );
  if (!result.ok) return result;
  const saved = tripFrom(row as TripRow);
  return saved === null ? { ok: false, error: 'unknown' } : { ok: true, trip: saved };
}

export function deleteSavedTrip(id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('saved_trips').delete().eq('id', id));
}
