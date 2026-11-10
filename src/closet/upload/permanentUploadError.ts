/**
 * Thrown by a queue step to mark an item failed immediately, skipping the usual 8-attempt backoff.
 * Its own module (re-exported by `runQueue.ts`) so `garmentRepository.ts` can throw it without
 * loading the queue's SQLite store.
 */
export class PermanentUploadError extends Error {}
