import { kvKeys, kvRemove, kvSet } from '../../lib/kv';

/**
 * Requests to drop an account's upload queue (`queue.purge.<userId>`), recorded when the device
 * forgets an account whose deletion was interrupted by a lost session (`forgetInterruptedDeletions`):
 * the queue store isn't loaded there, so the next `UploadQueueProvider` to mount clears that
 * account's rows and photo copies, then drops the request. Unlike the account's other kv keys, a
 * request survives `forgetAccountOnDevice` until it has been carried out.
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
