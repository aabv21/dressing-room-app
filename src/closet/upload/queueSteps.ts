import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { bumpPhotoVersion, garmentPhotoPath, insertGarment, uploadGarmentPhoto } from '../garmentRepository';
import { preparePhoto } from './preparePhoto';
import type { QueueItem } from './queueStore';
import type { QueueSteps } from './runQueue';

type Client = SupabaseClient<Database>;

/**
 * The real queue stages: prepare the photo on-device, upload both variants (upserts, so a retry
 * overwrites), then create the row or, for a replacement, bump its `photo_version`.
 *
 * NOTE: a replacement's commit re-reads the row each attempt, so a bump whose response was lost
 * and then retried bumps twice (1 → 3). Ceiling: harmless, the version only has to change;
 * upgrade path: store the version read at enqueue time and bump with an `eq('photo_version', …)` guard.
 */
export function createQueueSteps(client: Client = supabase): QueueSteps {
  async function commitReplacement(item: QueueItem): Promise<void> {
    const { data, error } = await client
      .from('garments')
      .select('id, photo_version')
      .eq('id', item.garmentId)
      .maybeSingle();
    if (error !== null) {
      throw error;
    }
    if (data !== null) {
      await bumpPhotoVersion(data, client);
      return;
    }
    // The garment was deleted while its new photo was queued: nothing to bump, and the photos
    // just uploaded belong to no row, so remove them again.
    const removed = await client.storage
      .from('garments')
      .remove([garmentPhotoPath(item.userId, item.garmentId, 'full'), garmentPhotoPath(item.userId, item.garmentId, 'thumb')]);
    if (removed.error !== null) {
      throw removed.error;
    }
  }

  return {
    prepare: (sourceUri) => preparePhoto(sourceUri),
    async upload(item) {
      await uploadGarmentPhoto(item.userId, item.garmentId, 'full', item.fullUri, client);
      await uploadGarmentPhoto(item.userId, item.garmentId, 'thumb', item.thumbUri, client);
    },
    async commit(item) {
      if (item.replace) {
        await commitReplacement(item);
      } else {
        await insertGarment(item.garmentId, client);
      }
    },
  };
}
