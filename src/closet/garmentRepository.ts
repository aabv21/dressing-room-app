import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import type { Database, Tables, TablesUpdate } from '../lib/database.types';
import { runRequest, type RequestOutcome, type RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';
import { PermanentUploadError } from './upload/permanentUploadError';

export type Garment = Tables<'garments'>;

/** The attribute, status and pin columns the closet UI edits (the column grants allow a few more). */
export type GarmentPatch = Pick<
  TablesUpdate<'garments'>,
  | 'category'
  | 'colors'
  | 'pattern'
  | 'material'
  | 'formality'
  | 'seasons'
  | 'warmth'
  | 'fit'
  | 'occasions'
  | 'status'
  | 'pinned_on'
>;

export type PhotoVariant = 'full' | 'thumb';

type Client = SupabaseClient<Database>;

const BUCKET = 'garments';
const SIGNED_URL_EXPIRY_S = 3600;

export function garmentPhotoPath(userId: string, garmentId: string, variant: PhotoVariant): string {
  return `${userId}/${garmentId}/${variant}.webp`;
}

/** The signed-in user's garments (RLS limits it to their own), newest first. */
export async function listGarments(client: Client = supabase): Promise<Garment[]> {
  const { data, error } = await client.from('garments').select('*').order('created_at', { ascending: false });
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Signed URLs (valid an hour) keyed by path; a path that can't be signed is simply absent. */
export async function signedPhotoUrls(paths: readonly string[], client: Client = supabase): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) {
    return urls;
  }
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls([...paths], SIGNED_URL_EXPIRY_S);
  if (error !== null) {
    throw error;
  }
  for (const entry of data) {
    if (entry.error === null && entry.path !== null && entry.signedUrl !== null) {
      urls.set(entry.path, entry.signedUrl);
    }
  }
  return urls;
}

/**
 * The status that describes a storage failure. Storage answers most client errors with HTTP 400
 * and the real status in the body (`{"statusCode":"413",...}` for a file over the bucket limit),
 * which storage-js exposes as `statusCode`; the body is trusted only on that HTTP 400, so a server
 * error's body can't turn it into a client error. A `fetch` that never got a response has neither.
 */
function storageStatus(error: { status: number | undefined; statusCode: string | undefined }): number | undefined {
  const fromBody = Number(error.statusCode);
  const bodyStatus = Number.isInteger(fromBody) && fromBody >= 100 && fromBody < 600 ? fromBody : undefined;
  return error.status === 400 && bodyStatus !== undefined ? bodyStatus : (error.status ?? bodyStatus);
}

/**
 * A 4xx means this request will never succeed as sent; 408 (timeout) and 429 (rate limit) are worth
 * retrying, and so are 401 and 403: an expired session (refreshed on the next run) or the RLS check
 * failing under another account's session (`SessionMismatchError`'s case) aren't the photo's fault.
 */
function isPermanentStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

/**
 * Upserts one photo variant from its bytes. Split from `uploadGarmentPhoto` so plain Node (the
 * integration tests) can drive the same storage call without expo-file-system.
 */
export async function uploadGarmentPhotoBytes(
  userId: string,
  garmentId: string,
  variant: PhotoVariant,
  bytes: Uint8Array<ArrayBuffer>,
  client: Client = supabase,
): Promise<void> {
  // An exact ArrayBuffer (not a view into a larger, pooled buffer), the body React Native's
  // fetch sends as-is.
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { error } = await client.storage
    .from(BUCKET)
    .upload(garmentPhotoPath(userId, garmentId, variant), body, { contentType: 'image/webp', upsert: true });
  if (error === null) {
    return;
  }
  const status = storageStatus(error);
  if (isPermanentStatus(status)) {
    throw new PermanentUploadError(`photo upload rejected (${String(status)})`, { cause: error });
  }
  throw error;
}

/** Uploads the WebP at `fileUri` as the garment's `variant`; a rejected (4xx) upload throws `PermanentUploadError`. */
export async function uploadGarmentPhoto(
  userId: string,
  garmentId: string,
  variant: PhotoVariant,
  fileUri: string,
  client: Client = supabase,
): Promise<void> {
  const bytes = await new File(fileUri).bytes();
  await uploadGarmentPhotoBytes(userId, garmentId, variant, bytes, client);
}

/**
 * Creates the garment row from the client-generated id, owned by `userId` (every other column
 * takes its default). Stating the owner makes RLS reject the insert (42501) if another account is
 * signed in by the time it runs, instead of filing the garment under that account; the error is
 * thrown as is, so the queue retries it rather than failing the photo. A row that already exists
 * is left alone, so a commit retried after a lost response is harmless.
 */
export async function insertGarment(id: string, userId: string, client: Client = supabase): Promise<void> {
  const { error } = await client
    .from('garments')
    .upsert({ id, user_id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error !== null) {
    throw error;
  }
}

/** Marks a replaced photo as new, so cached images keyed by `photo_version` are refetched. */
export async function bumpPhotoVersion(
  garment: Pick<Garment, 'id' | 'photo_version'>,
  client: Client = supabase,
): Promise<void> {
  const { error } = await client
    .from('garments')
    .update({ photo_version: garment.photo_version + 1 })
    .eq('id', garment.id);
  if (error !== null) {
    throw error;
  }
}

const reachedRow = ({ data }: RequestOutcome): boolean => Array.isArray(data) && data.length > 0;

export function updateGarment(id: string, patch: GarmentPatch, client: Client = supabase): Promise<RequestResult> {
  return runRequest(() => client.from('garments').update(patch).eq('id', id).select('id'), reachedRow);
}

/** Saves the reviewed attributes and stamps `reviewed_at` with the server's clock (`'now'`). */
export function confirmReview(id: string, patch: GarmentPatch, client: Client = supabase): Promise<RequestResult> {
  return runRequest(
    () =>
      client
        .from('garments')
        .update({ ...patch, reviewed_at: 'now' })
        .eq('id', id)
        .select('id'),
    reachedRow,
  );
}

/**
 * Deletes both photos, then the row. Photos go first so a failure part-way leaves the row in
 * place and a retry finishes the job (a missing object is not an error), rather than orphaning
 * photos nobody can see. A row that is already gone also counts as deleted.
 */
export function deleteGarment(userId: string, id: string, client: Client = supabase): Promise<RequestResult> {
  return runRequest(async () => {
    const removed = await client.storage
      .from(BUCKET)
      .remove([garmentPhotoPath(userId, id, 'full'), garmentPhotoPath(userId, id, 'thumb')]);
    if (removed.error !== null) {
      // No HTTP status means the request never got a response, i.e. the network failed.
      return { error: {}, status: removed.error.status ?? 0 };
    }
    return client.from('garments').delete().eq('id', id);
  });
}
