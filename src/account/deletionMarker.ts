import { requestQueuePurge } from '../closet/upload/queuePurge';
import { kvGet, kvKeys, kvRemove, kvSet } from '../lib/kv';
import { forgetAccountOnDevice } from './forgetAccount';

/**
 * The kv marker `account.deleting.<userId>`, written before the server call so a lost answer isn't
 * forgotten; what each state does: docs/app.md#account-deletion-on-the-device. Its id key segment lets
 * `forgetAccountOnDevice` remove it too.
 */
export type DeletionState = 'deleting' | 'reauth';

const PREFIX = 'account.deleting.';

/**
 * How long an existing account counts as maybe still being deleted: the function may sweep storage
 * after the app's 45 s timeout, up to the Edge Functions wall clock (150 s free, 400 s paid).
 */
export const DELETION_SETTLE_MS = 10 * 60 * 1000;

/** `markedAt` (ms) is null when the time is missing, malformed or over the settle window in the future. */
type Marker = { state: DeletionState; markedAt: number | null };

/**
 * Parses `<state>:<ms>`. A `deleting` or `reauth` state counts whatever its time, so a damaged value
 * never lets the queue run unchecked; only another state reads as none.
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

export function readDeletionMarker(userId: string, now: number = Date.now()): Marker | null {
  return parseMarker(kvGet(`${PREFIX}${userId}`), now);
}

export function clearDeletionMarker(userId: string): void {
  kvRemove(`${PREFIX}${userId}`);
}

/**
 * Drops the kv data of every other account still marked `deleting`, on each user change or sign-out.
 * The queue store isn't loaded here, so their queued photos get a `queue.purge.<uid>` request instead.
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
