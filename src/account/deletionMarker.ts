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

type Marker = { state: DeletionState; markedAt: number };

/**
 * Reads a marker value, `<state>:<ms>` (the time it was written). A bare `deleting` or `reauth`
 * (written before markers carried a time) reads as marked at 0, i.e. long ago.
 */
function parseMarker(value: string | null): Marker | null {
  if (value === null) return null;
  const [state, at] = value.split(':');
  if (state !== 'deleting' && state !== 'reauth') return null;
  const markedAt = at === undefined ? 0 : Number(at);
  return Number.isFinite(markedAt) ? { state, markedAt } : null;
}

export function markDeletion(userId: string, state: DeletionState, now: number = Date.now()): void {
  kvSet(`${PREFIX}${userId}`, `${state}:${String(now)}`);
}

export function deletionState(userId: string): DeletionState | null {
  return parseMarker(kvGet(`${PREFIX}${userId}`))?.state ?? null;
}

/** When the marker was written (ms since the epoch; 0 for an old-format marker), or null without one. */
export function deletionMarkedAt(userId: string): number | null {
  return parseMarker(kvGet(`${PREFIX}${userId}`))?.markedAt ?? null;
}

export function clearDeletionMarker(userId: string): void {
  kvRemove(`${PREFIX}${userId}`);
}

/**
 * Drops the device data of every account whose deletion was under way (`deleting`) and that
 * `activeUserId`'s session can't finish: called whenever the signed-in user changes or signs out.
 * NOTE: that account's pending photos stay in the upload queue's SQLite rows and copies (the queue
 * store isn't loaded here); they never upload without that user's session, and run again if the
 * account turns out to exist at its next sign-in. Upgrade path: a `queue.purge.<uid>` sweep when the
 * queue provider mounts.
 */
export function forgetInterruptedDeletions(activeUserId: string | null): void {
  for (const key of kvKeys()) {
    if (!key.startsWith(PREFIX)) continue;
    const userId = key.slice(PREFIX.length);
    if (userId !== activeUserId && parseMarker(kvGet(key))?.state === 'deleting') {
      forgetAccountOnDevice(userId);
    }
  }
}
