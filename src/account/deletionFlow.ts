import { signOutLocally } from '../auth/authService';
import type { MessageKey } from '../i18n';
import { deleteAccount, verifyAccount } from './accountClient';
import type { AccountError } from './accountClient';
import { clearDeletionMarker, DELETION_SETTLE_MS, deletionState, markDeletion, readDeletionMarker } from './deletionMarker';
import { forgetAccountOnDevice } from './forgetAccount';

/** The upload queue controls the deletion needs (`useUploadQueue`'s). */
export type QueueControl = {
  pause: () => Promise<void>;
  clear: () => void;
  resume: (options?: { run?: boolean }) => void;
};

/** `busy`: a deletion or launch check for this user is already running (e.g. a double tap). */
export type DeletionResult = 'deleted' | 'reauth' | AccountError | 'busy';

const running = new Set<string>();

/**
 * The device side of a confirmed deletion: clears the queue, signs out locally and drops the
 * account's device data, each step on its own so a failing one never skips the sign-out.
 */
async function finishLocally(userId: string, queue: QueueControl): Promise<void> {
  try {
    queue.clear();
  } catch {
    // The rows stay but never run: the marker blocks the queue until the cleanup below.
  }
  // Signed out before the kv cleanup, so no provider of this user writes its cache back.
  await signOutLocally();
  try {
    forgetAccountOnDevice(userId);
  } catch {
    // AuthProvider's sign-out handling drops the data of a still-marked account as well.
  }
  queue.resume({ run: false });
}

/**
 * Deletes `userId`'s account; only ever started by the user's tap:
 * 1. marks the deletion (`account.deleting.<id>`) and pauses the upload queue;
 * 2. calls `delete-account`;
 * 3. deleted: `finishLocally`;
 *    `reauth`: marks it `reauth` and signs out locally, keeping the data and photos;
 *    `network` or `unknown`: the server may have finished (a 500 or a gateway 502/504 can come
 *    after the user is gone), so the marker stays and keeps the queue blocked until the user taps
 *    again or the next launch confirms the account still exists (`confirmPendingDeletion`).
 * The queue is unpaused in every case, never with a run.
 */
export async function runDeletion(userId: string, queue: QueueControl): Promise<DeletionResult> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    try {
      markDeletion(userId, 'deleting');
    } catch {
      return 'unknown';
    }
    let outcome: Awaited<ReturnType<typeof deleteAccount>>;
    try {
      await queue.pause();
      outcome = await deleteAccount();
    } catch {
      outcome = { ok: false, error: 'unknown' };
    }
    if (outcome.ok) {
      await finishLocally(userId, queue);
      return 'deleted';
    }
    if (outcome.error === 'reauth') {
      try {
        // Unless the sign-out supabase-js already did (a refused refresh) has dropped the account's
        // data, marker included: then there is nothing left to retry from.
        if (deletionState(userId) !== null) markDeletion(userId, 'reauth');
      } catch {
        // Left as `deleting`: the sign-out below then drops the device data instead.
      }
      await signOutLocally();
      queue.resume({ run: false });
      return 'reauth';
    }
    queue.resume({ run: false });
    return outcome.error;
  } finally {
    running.delete(userId);
  }
}

export { DELETION_SETTLE_MS };

/**
 * While `userId`'s deletion is still marked (a launch, sign-in, foreground or reconnect): asks Auth,
 * without deleting anything, whether the account still exists. Gone → `finishLocally`, like a
 * confirmed deletion; still there more than `DELETION_SETTLE_MS` after the marker → the marker goes
 * and the queue runs again (deleting needs a new tap); anything else (offline, no usable session,
 * or still there right after the call) → the marker stays for the next check. A marker whose time
 * can't be trusted is stamped now, so the window starts over instead of being skipped.
 */
export async function confirmPendingDeletion(
  userId: string,
  queue: QueueControl,
  now: () => number = Date.now,
): Promise<'deleted' | 'kept' | 'pending' | 'busy'> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    const status = await verifyAccount(userId);
    if (status === 'gone') {
      await finishLocally(userId, queue);
      return 'deleted';
    }
    const marker = readDeletionMarker(userId, now());
    if (status === 'exists' && marker !== null && marker.markedAt === null) {
      try {
        markDeletion(userId, marker.state, now());
      } catch {
        // NOTE: the marker stays as it was; the next check tries to stamp it again.
      }
      return 'pending';
    }
    if (status === 'exists' && marker !== null && marker.markedAt !== null && now() - marker.markedAt >= DELETION_SETTLE_MS) {
      try {
        clearDeletionMarker(userId);
      } catch {
        return 'pending';
      }
      queue.resume();
      return 'kept';
    }
    return 'pending';
  } finally {
    running.delete(userId);
  }
}

/** The message for a deletion that didn't end in Welcome, if any. */
export function deletionMessage(result: DeletionResult): MessageKey | undefined {
  switch (result) {
    case 'reauth':
      return 'profile.privacy.deleteError.reauth';
    case 'network':
      return 'profile.privacy.deleteError.network';
    case 'unknown':
      return 'profile.privacy.deleteError.unknown';
    case 'deleted':
    case 'busy':
      return undefined;
  }
}
