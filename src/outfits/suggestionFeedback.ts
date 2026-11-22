import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../lib/database.types';
import { runRequest, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';
import { outfitIdentity } from './outfitIdentity';

type Client = SupabaseClient<Database>;

const reachedRow = ({ data }: { data?: unknown }): boolean => Array.isArray(data) && data.length > 0;

/** "Don't suggest this combination": lucky-list leaves it out from the next list on (docs/ai.md). A repeat is a no-op. */
export function dismissOutfit(garmentIds: readonly string[], client: Client = supabase): Promise<RequestResult> {
  return runRequest(() =>
    client
      .from('dismissed_outfits')
      .upsert({ outfit_key: outfitIdentity(garmentIds) }, { onConflict: 'user_id,outfit_key', ignoreDuplicates: true }),
  );
}

/** "Don't suggest this piece": lucky-list and for-you build no outfit with it; the garment detail turns it back on. */
export function stopSuggesting(garmentId: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('garments').update({ suggest: false }).eq('id', garmentId).select('id'), reachedRow);
}

/** The 5-second Undo after "Don't suggest this combination". */
export function undismissOutfit(garmentIds: readonly string[], client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('dismissed_outfits').delete().eq('outfit_key', outfitIdentity(garmentIds)));
}

/** The 5-second Undo after "Don't suggest this piece". */
export function resumeSuggesting(garmentId: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('garments').update({ suggest: true }).eq('id', garmentId).select('id'), reachedRow);
}

/** How many combinations the caller has dismissed; null when the count can't be read. */
export async function countDismissed(client: Client = supabase): Promise<number | null> {
  const { count, error } = await client.from('dismissed_outfits').select('outfit_key', { count: 'exact', head: true });
  return error === null ? count : null;
}

/** Profile's "Restore hidden suggestions": every dismissed combination of the caller goes. */
export function restoreDismissed(userId: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('dismissed_outfits').delete().eq('user_id', userId));
}
