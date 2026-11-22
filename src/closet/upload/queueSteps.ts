import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { bumpPhotoVersion, garmentPhotoPath, insertGarment, uploadGarmentPhoto } from '../garmentRepository';
import { preparePhoto } from './preparePhoto';
import type { QueueItem } from './queueStore';
import type { QueueSteps } from './runQueue';

type Client = SupabaseClient<Database>;

/** Another account signed in mid-pass. Retryable: the item runs again once its owner signs back in. */
export class SessionMismatchError extends Error {
  constructor() {
    super('upload queued by a different account than the current session');
    this.name = 'SessionMismatchError';
  }
}

/**
 * Uploads are upserts, so a retry overwrites; a replacement's commit bumps `photo_version`.
 * NOTE: a retried bump after a lost response bumps twice (1 → 3), harmless; upgrade: an `eq('photo_version', …)` guard.
 */
export function createQueueSteps(client: Client = supabase): QueueSteps {
  // Reads the stored session (no network unless the token needs refreshing).
  async function assertSessionOwns(item: QueueItem): Promise<void> {
    const { data } = await client.auth.getSession();
    if (data.session?.user.id !== item.userId) {
      throw new SessionMismatchError();
    }
  }

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
      await assertSessionOwns(item);
      await uploadGarmentPhoto(item.userId, item.garmentId, 'full', item.fullUri, client);
      await uploadGarmentPhoto(item.userId, item.garmentId, 'thumb', item.thumbUri, client);
    },
    async commit(item) {
      await assertSessionOwns(item);
      if (item.replace) {
        await commitReplacement(item);
      } else {
        await insertGarment(item.garmentId, item.userId, client);
      }
    },
  };
}
