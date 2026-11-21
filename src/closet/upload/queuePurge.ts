import { kvKeys, kvRemove, kvSet } from '../../lib/kv';

/**
 * `queue.purge.<userId>`: drop an interrupted deletion's queue at the next `UploadQueueProvider` mount;
 * it survives `forgetAccountOnDevice` until carried out (docs/app.md#account-deletion-on-the-device).
 */
export const QUEUE_PURGE_PREFIX = 'queue.purge.';

/** Written before the account's kv writes are refused, so it isn't refused itself. */
export function requestQueuePurge(userId: string): void {
  kvSet(`${QUEUE_PURGE_PREFIX}${userId}`, '1');
}

/** The user ids whose queue a purge was requested for. */
export function queuePurgeRequests(): string[] {
  return kvKeys()
    .filter((key) => key.startsWith(QUEUE_PURGE_PREFIX))
    .map((key) => key.slice(QUEUE_PURGE_PREFIX.length))
    .sort();
}

export function dropQueuePurgeRequest(userId: string): void {
  kvRemove(`${QUEUE_PURGE_PREFIX}${userId}`);
}
