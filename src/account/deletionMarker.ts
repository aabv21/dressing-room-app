import { requestQueuePurge } from '../closet/upload/queuePurge';
import { kvGet, kvKeys, kvRemove, kvSet } from '../lib/kv';
import { forgetAccountOnDevice } from './forgetAccount';

/**
 * The kv marker `account.deleting.<userId>`, written before this device asks the server to delete
 * an account, so an answer that never arrives (lost connection, app killed or backgrounded) is not
 * forgotten:
 * - `deleting`: the deletion may have finished on the server. While any marker exists, that user's
 *   upload queue never runs; their next session checks whether the account still exists (never
 *   deleting it without a tap); and if the session ends without one (supabase-js signs out by
 *   itself once the account is gone), the device still drops that account's kv data.
 * - `reauth`: the server couldn't be asked with this session, so the user signed out to sign in
 *   again; the data stays until that session's check.
 * The marker has the user's id as a key segment, so `forgetAccountOnDevice` removes it too.
 */
export type DeletionState = 'deleting' | 'reauth';

const PREFIX = 'account.deleting.';

/**
 * How long after the marker an account that still exists counts as "maybe still being deleted":
 * the function may still be sweeping storage after the app gave up waiting (its 45 s timeout),
 * up to the Edge Functions wall clock (150 s free, 400 s paid), so 10 minutes leaves a margin.
 */
export const DELETION_SETTLE_MS = 10 * 60 * 1000;

/**
 * `markedAt` is null when the written time can't be trusted: missing, malformed, or more than the
 * settle window in the future.
 */
type Marker = { state: DeletionState; markedAt: number | null };

/**
 * Reads a marker value, `<state>:<ms>` (the time it was written). Any value whose state is
 * `deleting` or `reauth` counts as a marker, whatever its time, so a damaged value never lets the
 * queue run unchecked; only a value with another state reads as none.
 */
function parseMarker(value: string | null, now: number): Marker | null {
  if (value === null) return null;
  const separator = value.indexOf(':');
  const state = separator === -1 ? value : value.slice(0, separator);
  if (state !== 'deleting' && state !== 'reauth') return null;
  const at = separator === -1 ? '' : value.slice(separator + 1);
  const markedAt = /^\d+$/.test(at) ? Number(at) : Number.NaN;
  const trusted = Number.isSafeInteger(markedAt) && markedAt <= now + DELETION_SETTLE_MS;
  return { state, markedAt: trusted ? markedAt : null };
}

export function markDeletion(userId: string, state: DeletionState, now: number = Date.now()): void {
  kvSet(`${PREFIX}${userId}`, `${state}:${String(now)}`);
}

export function deletionState(userId: string): DeletionState | null {
  return parseMarker(kvGet(`${PREFIX}${userId}`), Date.now())?.state ?? null;
}

/**
 * The marker's state and when it was written (ms since the epoch; null when that time can't be
 * trusted), or null without a marker.
 */
export function readDeletionMarker(userId: string, now: number = Date.now()): Marker | null {
  return parseMarker(kvGet(`${PREFIX}${userId}`), now);
}

export function clearDeletionMarker(userId: string): void {
  kvRemove(`${PREFIX}${userId}`);
}

/**
 * Drops the device data of every account whose deletion was under way (`deleting`) and that
 * `activeUserId`'s session can't finish: called whenever the signed-in user changes or signs out.
 * The queue store isn't loaded here, so that account's pending photos (SQLite rows and copies) are
 * left to a purge request (`queue.purge.<uid>`), which the next upload queue provider to mount
 * carries out. Until then they never upload without that user's session.
 */
export function forgetInterruptedDeletions(activeUserId: string | null): void {
  for (const key of kvKeys()) {
    if (!key.startsWith(PREFIX)) continue;
    const userId = key.slice(PREFIX.length);
    if (userId !== activeUserId && parseMarker(kvGet(key), Date.now())?.state === 'deleting') {
      requestQueuePurge(userId);
      forgetAccountOnDevice(userId);
    }
  }
}
